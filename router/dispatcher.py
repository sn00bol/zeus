"""
router/dispatcher — Dynamic Provider and Model Routing Engine.

Analyzes task complexity, provider health, and model capabilities to dispatch
inference requests to the optimal backend with automatic multi-provider failover.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from core.model import ModelManager
from router.broker import EventBroker, get_event_broker
from src.provider import detect_supports_thinking

log = logging.getLogger(__name__)

# Patterns identifying code generation or refactoring requests
_CODE_PATTERNS = [
    re.compile(r"```[a-zA-Z]*", re.MULTILINE),
    re.compile(r"\b(def|class|function|import|export|const|let|var|return|SELECT|UPDATE|INSERT)\b"),
    re.compile(r"\b(code|refactor|debug|implement|script|syntax|algorithm)\b", re.IGNORECASE),
]

# Patterns identifying complex reasoning requests
_REASONING_PATTERNS = [
    re.compile(r"\b(step[-\s]?by[-\s]?step|think|reasoning|explain\s+why|analyze|compare|evaluate|proof|derive)\b", re.IGNORECASE),
    re.compile(r"\b(architecture|trade-offs|pros\s+and\s+cons|thoroughly|detailed\s+plan)\b", re.IGNORECASE),
    re.compile(r"\b(suy\s+nghĩ|tại\s+sao|giải\s+thích|phân\s+tích|chứng\s+minh|tính\s+toán|so\s+sánh|kế\s+hoạch|lập\s+luận|hãy\s+nghĩ|bước\s+bước)\b", re.IGNORECASE),
]

def is_reasoning_model(model_name: str | None) -> bool:
    """Return True if the model name indicates a reasoning-focused model."""
    return detect_supports_thinking(model_name) if model_name else False



@dataclass(frozen=True)
class TaskComplexity:
    level: str                  # "simple" | "moderate" | "complex"
    estimated_tokens: int
    has_code: bool
    reasoning_heavy: bool
    reasons: list[str] = field(default_factory=list)


@dataclass
class RoutingDecision:
    provider_name: str
    model_name: str | None
    complexity: TaskComplexity
    strategy: str               # "explicit" | "complexity_matched" | "health_fallback"
    fallback_providers: list[str] = field(default_factory=list)


def analyze_task_complexity(messages: list[Any]) -> TaskComplexity:
    """
    Evaluate conversation turns to determine task complexity and processing requirements.
    """
    total_chars = sum(len(getattr(m, "content", "") or str(m.get("content", ""))) for m in messages)
    estimated_tokens = max(1, total_chars // 4)

    full_text = " ".join(getattr(m, "content", "") or str(m.get("content", "")) for m in messages)

    has_code = any(pat.search(full_text) for pat in _CODE_PATTERNS)
    reasoning_heavy = any(pat.search(full_text) for pat in _REASONING_PATTERNS)

    reasons: list[str] = []
    score = 0

    if estimated_tokens > 2000:
        score += 2
        reasons.append("Long context history (>2k tokens)")
    elif estimated_tokens > 600:
        score += 1
        reasons.append("Moderate context history")

    if has_code:
        score += 2
        reasons.append("Detected programming/code structures")

    if reasoning_heavy:
        score += 2
        reasons.append("Detected deep reasoning/analytical keywords")

    if score >= 4:
        level = "complex"
    elif score >= 2:
        level = "moderate"
    else:
        level = "simple"
        reasons.append("Standard conversational turn")

    return TaskComplexity(
        level=level,
        estimated_tokens=estimated_tokens,
        has_code=has_code,
        reasoning_heavy=reasoning_heavy,
        reasons=reasons,
    )


def should_enable_thinking(complexity: TaskComplexity, model_name: str | None = None) -> bool:
    """Enable local-model thinking for medium and heavy prompts or reasoning models."""
    if is_reasoning_model(model_name):
        return True
    return complexity.level in {"moderate", "complex"} or complexity.reasoning_heavy



class DynamicDispatcher:
    """
    Intelligent router selecting the optimal LLM provider and handling automated failover.
    """

    def __init__(
        self,
        model_manager: ModelManager,
        broker: EventBroker | None = None,
    ) -> None:
        self.model_manager = model_manager
        self.broker = broker or get_event_broker()

    async def dispatch(
        self,
        messages: list[Any],
        requested_provider: str | None = None,
        requested_model: str | None = None,
    ) -> RoutingDecision:
        """
        Evaluate request and available backends to choose provider and model.
        """
        complexity = analyze_task_complexity(messages)
        if hasattr(self.model_manager, "available_providers"):
            try:
                available = await self.model_manager.available_providers()
            except Exception:
                available = []
        else:
            available = [requested_provider] if requested_provider else ["ollama"]

        if not available:
            # Fall back to configured default or ollama
            fallback_name = (requested_provider or "ollama").lower()
            return RoutingDecision(
                provider_name=fallback_name,
                model_name=requested_model,
                complexity=complexity,
                strategy="no_reachable_providers",
                fallback_providers=[],
            )

        # 1. Explicit provider override
        if requested_provider and requested_provider.strip().lower() in available:
            chosen = requested_provider.strip().lower()
            fallbacks = [p for p in available if p != chosen]
            decision = RoutingDecision(
                provider_name=chosen,
                model_name=requested_model,
                complexity=complexity,
                strategy="explicit",
                fallback_providers=fallbacks,
            )
            await self._publish_decision(decision)
            return decision

        # 2. Dynamic Complexity & Model Matching
        # Priority hierarchy based on task complexity
        if complexity.level == "complex":
            # For complex code or reasoning, prefer provider with larger models loaded
            # Ollama or LM Studio generally run heavier quantized models in local setup
            chosen = available[0]
            fallbacks = [p for p in available if p != chosen]
            decision = RoutingDecision(
                provider_name=chosen,
                model_name=requested_model,
                complexity=complexity,
                strategy="complexity_matched",
                fallback_providers=fallbacks,
            )
        else:
            # For simple tasks, pick first available provider for low latency
            chosen = available[0]
            fallbacks = [p for p in available if p != chosen]
            decision = RoutingDecision(
                provider_name=chosen,
                model_name=requested_model,
                complexity=complexity,
                strategy="fast_path",
                fallback_providers=fallbacks,
            )

        await self._publish_decision(decision)
        return decision

    async def execute_with_failover(
        self,
        initial_decision: RoutingDecision,
        call_fn: Callable[[str, str | None], Awaitable[Any]],
    ) -> tuple[Any, str]:
        """
        Execute backend call with automatic failover across reachable providers.

        Parameters
        ----------
        initial_decision : RoutingDecision
            The initial routing choice.
        call_fn : Callable[[provider_name, model_name], Awaitable[Response]]
            Function to execute the inference.

        Returns
        -------
        tuple[Response, successful_provider_name]
        """
        candidates = [initial_decision.provider_name, *initial_decision.fallback_providers]
        last_error: Exception | None = None

        for candidate in candidates:
            try:
                result = await call_fn(candidate, initial_decision.model_name)
                if candidate != initial_decision.provider_name:
                    log.warning(
                        "Dynamic routing failover succeeded on candidate '%s' (initial: '%s')",
                        candidate,
                        initial_decision.provider_name,
                    )
                    await self.broker.publish(
                        "routing.failover",
                        {
                            "from_provider": initial_decision.provider_name,
                            "to_provider": candidate,
                            "reason": str(last_error),
                        },
                    )
                return result, candidate
            except Exception as exc:
                last_error = exc
                log.warning("Inference failed on provider '%s': %s. Trying fallback...", candidate, exc)

        # If all candidates fail, raise the last error
        if last_error is not None:
            raise last_error
        raise RuntimeError("No provider candidates available for inference execution.")

    async def _publish_decision(self, decision: RoutingDecision) -> None:
        await self.broker.publish(
            "routing.dispatched",
            {
                "provider": decision.provider_name,
                "model": decision.model_name,
                "complexity": decision.complexity.level,
                "strategy": decision.strategy,
                "fallbacks": decision.fallback_providers,
            },
        )

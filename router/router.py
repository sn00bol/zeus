"""
router/router — Central request router between platforms and LLM backends.

Flow
----
Platform (Discord, WebUI, Telegram, …)
    → InferenceRequest
    → Router.route()
        → analyzes task complexity via DynamicDispatcher
        → selects optimal BaseProvider & handles automatic failover
        → calls provider's OpenAI-compatible REST endpoint
        → wraps response in InferenceResponse
        → publishes real-time lifecycle events to EventBroker
    → Platform receives InferenceResponse

The Router is intentionally stateless per-request; provider instances are
kept alive as a pool so their HTTP connections and /props caches are reused.
"""

from __future__ import annotations

import logging
import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

from core.model import ModelContext, ModelManager
from core.memory import MemoryStore
from core.session import Session
from core.session_manager import SessionManager
from src.provider import BaseProvider
from src.skills.personality import Personality

from router.broker import EventBroker, get_event_broker
from router.dispatcher import DynamicDispatcher
from router.health import HealthMonitor, get_health_monitor
from router.security import SecurityManager, get_security_manager

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Request / Response contracts
# ---------------------------------------------------------------------------

@dataclass
class Message:
    """A single turn in a conversation (mirrors the OpenAI messages format)."""
    role: str           # "system" | "user" | "assistant"
    content: str


@dataclass
class InferenceRequest:
    """
    Platform-agnostic request payload sent to the router.

    Parameters
    ----------
    messages : list[Message]
        Conversation history including the current user turn.
        The router prepends the personality system message if none is present.
    model : str | None
        Explicit model id to use. If None, the router picks the first
        available model on the active provider.
    provider_name : str | None
        Which backend to use ("ollama", "lmstudio", "llamacpp").
        Defaults to the ZEUS_PROVIDER env var or dynamic complexity routing.
    stream : bool
        Whether to request a streaming response from the backend.
    temperature : float | None
        Override the personality's temperature.
    max_tokens : int | None
        Cap on tokens to generate. If None, uses the provider's model limit.
    platform : str
        Source platform tag ("discord", "telegram", "webui"). Informational.
    extra : dict
        Arbitrary extra fields forwarded verbatim to the backend.
    """

    messages: list[Message]
    model: str | None = None
    provider_name: str | None = None
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    personality: Personality | None = None
    platform: str = "unknown"
    extra: dict[str, Any] = field(default_factory=dict)
    session: Session | None = None


@dataclass
class InferenceResponse:
    """
    Normalised response returned to the calling platform.
    """

    content: str                        # generated text
    model: str                          # model that produced the response
    provider: str                       # backend that served the request
    prompt_tokens: int = 0
    completion_tokens: int = 0
    finish_reason: str = "stop"
    raw: dict[str, Any] = field(default_factory=dict)  # full backend response


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

class Router:
    """
    Manages a pool of provider instances, routes InferenceRequests to
    the correct backend, and coordinates events, dynamic routing, and security.
    """

    def __init__(
        self,
        model_manager: ModelManager | None = None,
        memory_store: MemoryStore | None = None,
        session_manager: SessionManager | None = None,
        broker: EventBroker | None = None,
        dispatcher: DynamicDispatcher | None = None,
        health_monitor: HealthMonitor | None = None,
        security_manager: SecurityManager | None = None,
    ) -> None:
        self.memory_store = memory_store
        self.session_manager = session_manager
        self.model_manager = model_manager or ModelManager(memory_store=memory_store)
        self.broker = broker or get_event_broker()
        self.dispatcher = dispatcher or DynamicDispatcher(self.model_manager, broker=self.broker)
        self.health_monitor = health_monitor or get_health_monitor(
            database=getattr(memory_store, "_database", None),
            model_manager=self.model_manager,
        )
        self.security_manager = security_manager or get_security_manager()
        self._http_client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Return a shared AsyncClient to reuse TCP connections."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(
                timeout=120,
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
            )
        return self._http_client

    async def shutdown(self) -> None:
        """Close the shared HTTP client and stop background tasks."""
        if self._http_client:
            await self._http_client.aclose()
        if self.health_monitor:
            await self.health_monitor.stop()

    # ------------------------------------------------------------------
    # Provider pool
    # ------------------------------------------------------------------

    def get_provider(self, name: str) -> BaseProvider:
        """Return a (cached) provider instance for *name*."""
        return self.model_manager.get_provider(name)

    async def available_providers(self) -> list[str]:
        """Return names of providers that are currently reachable."""
        return await self.model_manager.available_providers()

    async def available_models(self) -> list[dict[str, str]]:
        """Discover locally loaded models on each reachable supported provider."""
        return await self.model_manager.available_models()

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    async def route(self, request: InferenceRequest) -> InferenceResponse:
        """
        Route *request* to the appropriate LLM backend and return the response.

        Leverages DynamicDispatcher for complexity analysis and multi-provider failover.
        """
        start_time = time.perf_counter()
        platform = getattr(request, "platform", "unknown")
        req_model = getattr(request, "model", None)
        req_provider = getattr(request, "provider_name", None)
        req_messages = getattr(request, "messages", [])
        req_stream = getattr(request, "stream", False)
        req_extra = getattr(request, "extra", {})

        await self.broker.publish(
            "inference.started",
            {
                "platform": platform,
                "model": req_model,
                "provider": req_provider,
                "message_count": len(req_messages),
            },
        )

        try:
            context = await self.model_manager.resolve(request)
            client = await self._get_client()

            # Analyze complexity and decide provider candidates
            decision = await self.dispatcher.dispatch(
                messages=req_messages,
                requested_provider=req_provider or context.provider_name,
                requested_model=req_model or context.model_name,
            )

            async def _execute_provider(p_name: str, m_name: str | None) -> tuple[dict[str, Any], ModelContext]:
                if p_name == context.provider_name and (m_name is None or m_name == context.model_name):
                    active_context = context
                else:
                    alt_req = InferenceRequest(
                        messages=req_messages,
                        model=m_name,
                        provider_name=p_name,
                        stream=req_stream,
                        temperature=getattr(request, "temperature", None),
                        max_tokens=getattr(request, "max_tokens", None),
                        personality=getattr(request, "personality", None),
                        platform=platform,
                        extra=req_extra,
                        session=getattr(request, "session", None),
                    )
                    active_context = await self.model_manager.resolve(alt_req)

                raw = await self._call_backend(
                    provider=active_context.provider,
                    model_id=active_context.model_name,
                    messages=active_context.messages,
                    temperature=active_context.temperature,
                    max_tokens=active_context.max_tokens,
                    stream=req_stream,
                    extra=req_extra,
                    api_token=active_context.api_token,
                    client=client,
                )
                return raw, active_context

            (raw_response, final_context), effective_provider = await self.dispatcher.execute_with_failover(
                decision,
                _execute_provider,
            )

            response = self._parse_response(
                raw_response, effective_provider, final_context.model_name
            )
            await self._record_response(request, final_context, response)

            latency = round((time.perf_counter() - start_time) * 1000.0, 2)
            await self.broker.publish(
                "inference.completed",
                {
                    "platform": platform,
                    "provider": response.provider,
                    "model": response.model,
                    "prompt_tokens": response.prompt_tokens,
                    "completion_tokens": response.completion_tokens,
                    "latency_ms": latency,
                },
            )
            return response

        except Exception as exc:
            await self.broker.publish(
                "inference.failed",
                {
                    "platform": platform,
                    "provider": req_provider,
                    "error": str(exc),
                },
            )
            raise

    async def route_stream(
        self,
        request: InferenceRequest,
        on_delta: Callable[[str], Awaitable[None]],
    ) -> InferenceResponse:
        """Stream model deltas to a callback and return the completed response."""
        start_time = time.perf_counter()
        platform = getattr(request, "platform", "unknown")
        req_model = getattr(request, "model", None)
        req_provider = getattr(request, "provider_name", None)
        req_extra = getattr(request, "extra", {})

        await self.broker.publish(
            "inference.stream.started",
            {
                "platform": platform,
                "model": req_model,
                "provider": req_provider,
            },
        )

        try:
            context = await self.model_manager.resolve(request)
            client = await self._get_client()
            content, usage, finish_reason, actual_model = await self._stream_backend(
                provider=context.provider,
                model_id=context.model_name,
                messages=context.messages,
                temperature=context.temperature,
                max_tokens=context.max_tokens,
                extra=req_extra,
                client=client,
                api_token=context.api_token,
                on_delta=on_delta,
            )
            response = InferenceResponse(
                content=content,
                model=actual_model,
                provider=context.provider_name,
                prompt_tokens=usage.get("prompt_tokens", 0),
                completion_tokens=usage.get("completion_tokens", 0),
                finish_reason=finish_reason,
                raw={"stream": True},
            )
            await self._record_response(request, context, response)

            latency = round((time.perf_counter() - start_time) * 1000.0, 2)
            await self.broker.publish(
                "inference.stream.completed",
                {
                    "platform": platform,
                    "provider": response.provider,
                    "model": response.model,
                    "latency_ms": latency,
                },
            )
            return response

        except Exception as exc:
            await self.broker.publish(
                "inference.stream.failed",
                {"platform": platform, "error": str(exc)},
            )
            raise

    async def _record_response(
        self,
        request: InferenceRequest,
        context: ModelContext,
        response: InferenceResponse,
    ) -> None:
        session = context.session
        if self.session_manager is not None and session is not None:
            try:
                await self.session_manager.record_usage(
                    session,
                    prompt_tokens=response.prompt_tokens,
                    completion_tokens=response.completion_tokens,
                    provider=response.provider,
                    model=response.model,
                    context_length=context.context_length,
                )
            except Exception:
                log.exception("Could not save usage for session %s", session.session_id)
        if self.memory_store is not None and session is not None and session.user_id:
            question = next(
                (message.content for message in reversed(request.messages) if message.role == "user"),
                "",
            )
            if question.strip() and response.content.strip():
                try:
                    await self.memory_store.remember_turn(
                        platform=session.platform,
                        user_id=session.user_id,
                        conversation_id=session.conversation_id,
                        question=question,
                        answer=response.content,
                    )
                except Exception:
                    log.exception("Could not save conversation memory for user %s", session.user_id)

    # ------------------------------------------------------------------
    # Backend request
    # ------------------------------------------------------------------

    @staticmethod
    async def _call_backend(
        provider: BaseProvider,
        model_id: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int | None,
        stream: bool,
        extra: dict[str, Any],
        client: httpx.AsyncClient,
        api_token: str | None = None,
    ) -> dict[str, Any]:
        """POST to the provider's chat/completions endpoint."""
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        ep = provider.endpoint
        base = ep.base_url

        if provider.name == "ollama":
            url = f"{base}/v1/chat/completions"
        else:
            chat_path = "/chat/completions"
            url = base.rstrip("/") + chat_path

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            "stream": stream,
            **extra,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {"Authorization": f"Bearer {api_token}"} if api_token else None
        resp = await client.post(
            url,
            json=payload,
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json()

    @staticmethod
    async def _stream_backend(
        provider: BaseProvider,
        model_id: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int | None,
        extra: dict[str, Any],
        client: httpx.AsyncClient,
        api_token: str | None,
        on_delta: Callable[[str], Awaitable[None]],
    ) -> tuple[str, dict[str, int], str, str]:
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        base = provider.endpoint.base_url.rstrip("/")
        url = (
            f"{base}/v1/chat/completions"
            if provider.name == "ollama"
            else f"{base}/chat/completions"
        )
        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            **extra,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        headers = {"Authorization": f"Bearer {api_token}"} if api_token else None

        parts: list[str] = []
        usage = {"prompt_tokens": 0, "completion_tokens": 0}
        finish_reason = "stop"
        actual_model = model_id
        terminal_received = False
        stream_timeout = httpx.Timeout(connect=10, read=None, write=30, pool=10)
        async with client.stream(
            "POST",
            url,
            json=payload,
            headers=headers,
            timeout=stream_timeout,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                if data == "[DONE]":
                    terminal_received = True
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError as exc:
                    raise RuntimeError("The model returned malformed streaming data.") from exc
                if not isinstance(chunk, dict):
                    raise RuntimeError("The model returned an invalid streaming event.")
                if "error" in chunk:
                    detail = chunk["error"]
                    raise RuntimeError(f"The model stream failed: {detail}")
                actual_model = str(chunk.get("model") or actual_model)
                chunk_usage = chunk.get("usage")
                if isinstance(chunk_usage, dict):
                    for key in usage:
                        value = chunk_usage.get(key)
                        if isinstance(value, int) and value >= 0:
                            usage[key] = value
                choices = chunk.get("choices")
                if not isinstance(choices, list) or not choices:
                    continue
                choice = choices[0]
                if not isinstance(choice, dict):
                    continue
                chunk_finish_reason = choice.get("finish_reason")
                if chunk_finish_reason:
                    finish_reason = str(chunk_finish_reason)
                    terminal_received = True
                delta = choice.get("delta")
                text = delta.get("content") if isinstance(delta, dict) else None
                if isinstance(text, str) and text:
                    parts.append(text)
                    await on_delta(text)
        if not terminal_received:
            raise RuntimeError("The model stream ended before the response was complete.")
        return "".join(parts), usage, str(finish_reason), actual_model

    @staticmethod
    def _parse_response(raw: dict[str, Any], provider: str, model: str) -> InferenceResponse:
        """Normalise the OpenAI-compatible JSON response into InferenceResponse."""
        choices: list[dict[str, Any]] = raw.get("choices", [])
        content = ""
        finish_reason = "stop"
        if choices:
            first = choices[0]
            msg = first.get("message", {})
            content = msg.get("content", "")
            finish_reason = first.get("finish_reason", "stop") or "stop"

        usage: dict[str, Any] = raw.get("usage", {})
        return InferenceResponse(
            content=content,
            model=raw.get("model", model),
            provider=provider,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            finish_reason=finish_reason,
            raw=raw,
        )

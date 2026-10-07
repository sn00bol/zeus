"""
router/router — Central request router between platforms and LLM backends.

Flow
----
Platform (Discord, Telegram, …)
    → InferenceRequest
    → Router.route()
        → selects BaseProvider
        → calls provider's OpenAI-compatible REST endpoint
        → wraps response in InferenceResponse
    → Platform receives InferenceResponse

The Router is intentionally stateless per-request; provider instances are
kept alive as a pool so their HTTP connections and /props caches are reused.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

from core.model import ModelManager
from core.memory import MemoryStore
from core.session import Session
from core.session_manager import SessionManager
from src.provider import BaseProvider
from src.skills.personality import Personality

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
        Explicit model id to use.  If None, the router picks the first
        available model on the active provider.
    provider_name : str | None
        Which backend to use (``"ollama"``, ``"lmstudio"``, ``"llamacpp"``).
        Defaults to the ``ZEUS_PROVIDER`` env var or ``"ollama"``.
    stream : bool
        Whether to request a streaming response from the backend.
    temperature : float | None
        Override the personality's temperature.
    max_tokens : int | None
        Cap on tokens to generate.  If None, uses the provider's model limit.
    platform : str
        Source platform tag (``"discord"``, ``"telegram"``, …).  Informational.
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
    Manages a pool of provider instances and routes InferenceRequests to
    the correct backend.

    Usage
    -----
    ::

        router = Router()
        response = await router.route(request)
    """

    def __init__(
        self,
        model_manager: ModelManager | None = None,
        memory_store: MemoryStore | None = None,
        session_manager: SessionManager | None = None,
    ) -> None:
        self.memory_store = memory_store
        self.session_manager = session_manager
        self.model_manager = model_manager or ModelManager(memory_store=memory_store)
        self._http_client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Return a shared AsyncClient to reuse TCP connections."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=120, limits=httpx.Limits(max_connections=100, max_keepalive_connections=20))
        return self._http_client

    async def shutdown(self) -> None:
        """Close the shared HTTP client."""
        if self._http_client:
            await self._http_client.aclose()


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

        Selection order
        ~~~~~~~~~~~~~~~
        1. ``request.provider_name`` (explicit)
        2. ``ZEUS_PROVIDER`` environment variable
        3. First reachable provider from the discovery scan
        """
        context = await self.model_manager.resolve(request)
        client = await self._get_client()

        # Call backend
        raw = await self._call_backend(
            provider=context.provider,
            model_id=context.model_name,
            messages=context.messages,
            temperature=context.temperature,
            max_tokens=context.max_tokens,
            stream=request.stream,
            extra=request.extra,
            api_token=context.api_token,
            client=client,
        )

        response = self._parse_response(raw, context.provider_name, context.model_name)

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
        return response

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

        # All three supported providers expose a /chat/completions-compatible path
        ep = provider.endpoint
        base = ep.base_url

        # Normalise base URL to include /v1 if needed
        if provider.name == "ollama":
            url = f"{base}/v1/chat/completions"
        else:
            # lmstudio and llamacpp already include /v1 in base_url
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

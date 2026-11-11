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
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

from core.model import ModelContext, ModelManager, format_search_context
from core.memory import MemoryStore
from core.session import Session
from core.session_manager import SessionManager
from src.provider import BaseProvider
from src.tools.search import (
    SEARCH_INTENT_PROMPT,
    SEARCH_RELEVANCE_PROMPT,
    SearchDecision,
    SearchResult,
    parse_search_decision,
    parse_search_relevance,
)
from vendor.search.config import SearchConfig

from router.broker import EventBroker, get_event_broker
from router.dispatcher import (
    DynamicDispatcher,
    analyze_task_complexity,
    should_enable_thinking,
)
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
    provider_content: list[dict[str, Any]] | None = None


@dataclass
class InferenceRequest:
    """
    Platform-agnostic request payload sent to the router.

    Parameters
    ----------
    messages : list[Message]
        Conversation history including the current user turn.
        The router prepends SOUL, SAFETY, SKILL.md, and any auto-selected
        skills if no system message is present.
    model : str | None
        Explicit model id to use. If None, the router picks the first
        available model on the active provider.
    provider_name : str | None
        Which backend to use ("ollama", "lmstudio", "llamacpp").
        Defaults to the ZEUS_PROVIDER env var or dynamic complexity routing.
    stream : bool
        Whether to request a streaming response from the backend.
    temperature : float | None
        Sampling temperature. If None, the default skill runtime temperature is used.
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
    thinking: str = ""                  # model reasoning, when enabled
    raw: dict[str, Any] = field(default_factory=dict)  # full backend response
    context_length: int | None = None
    sources: list[dict[str, str]] = field(default_factory=list)


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
        search_config: SearchConfig | None = None,
    ) -> None:
        self.memory_store = memory_store
        self.session_manager = session_manager
        self.model_manager = model_manager or ModelManager(
            memory_store=memory_store,
            search_config=search_config,
        )
        self._search_config = (
            search_config
            or getattr(self.model_manager, "search_config", None)
            or SearchConfig()
        )
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

    @staticmethod
    def _request_with_extra(
        request: InferenceRequest,
        extra: dict[str, Any],
        *,
        provider_name: str | None = None,
        model: str | None = None,
    ) -> InferenceRequest:
        return InferenceRequest(
            messages=getattr(request, "messages", []),
            model=model if model is not None else getattr(request, "model", None),
            provider_name=(
                provider_name
                if provider_name is not None
                else getattr(request, "provider_name", None)
            ),
            stream=getattr(request, "stream", False),
            temperature=getattr(request, "temperature", None),
            max_tokens=getattr(request, "max_tokens", None),
            platform=getattr(request, "platform", "unknown"),
            extra=extra,
            session=getattr(request, "session", None),
        )

    async def _plan_search(
        self,
        request: InferenceRequest,
        context: ModelContext,
        client: Any,
    ) -> tuple[InferenceRequest, ModelContext]:
        extra = dict(request.extra)
        explicit_search = (
            isinstance(extra.get("tools"), list) and "search" in extra["tools"]
        )
        messages = [
            {"role": message.role, "content": message.content}
            for message in request.messages
            if message.role in {"user", "assistant"}
        ][-6:]
        user_messages = [message for message in messages if message["role"] == "user"]
        if not user_messages:
            return request, context
        latest_question = user_messages[-1]["content"]
        search_command = re.match(
            r"^\s*@search(?:\s+|$)",
            latest_question,
            re.IGNORECASE,
        )
        if search_command:
            explicit_search = True
            search_question = (
                latest_question[search_command.end():].strip()
                or latest_question.strip()
            )
        else:
            search_question = latest_question
        if explicit_search:
            decision = SearchDecision(True, search_question, "search")
        else:
            planner_input = json.dumps(
                {
                    "search_selected_by_user": explicit_search,
                    "conversation": [
                        {
                            "role": message["role"],
                            "content": message["content"][-4000:],
                        }
                        for message in messages
                    ],
                },
                ensure_ascii=False,
            )

            decision = SearchDecision(False, search_question, "search")
            try:
                planner_response = await self._call_backend(
                    provider=context.provider,
                    model_id=context.model_name,
                    messages=[
                        {"role": "system", "content": SEARCH_INTENT_PROMPT},
                        {"role": "user", "content": planner_input},
                    ],
                    temperature=0,
                    max_tokens=160,
                    stream=False,
                    extra={},
                    api_token=context.api_token,
                    client=client,
                    think=False,
                )
                choices = planner_response.get("choices")
                planner_text = ""
                if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                    message = choices[0].get("message")
                    if isinstance(message, dict) and isinstance(message.get("content"), str):
                        planner_text = message["content"]
                decision = parse_search_decision(
                    planner_text,
                    fallback_query=search_question,
                    force_search=explicit_search,
                )
            except Exception:
                log.exception("Automatic web-search planning failed.")

        if not decision.use_search:
            return request, context

        selected_tools = extra.get("tools")
        existing_tools = (
            [tool for tool in selected_tools if isinstance(tool, str)]
            if isinstance(selected_tools, list)
            else []
        )
        extra["tools"] = list(dict.fromkeys([*existing_tools, "search"]))
        extra["search_query"] = decision.query or search_question
        extra["search_skill"] = decision.skill
        planned_request = self._request_with_extra(
            request,
            extra,
            provider_name=context.provider_name,
            model=context.model_name,
        )
        context = await self.model_manager.resolve(planned_request)
        return planned_request, await self._screen_search_results(
            planned_request,
            context,
            client,
        )

    async def _screen_search_results(
        self,
        request: InferenceRequest,
        context: ModelContext,
        client: Any,
    ) -> ModelContext:
        results = context.search_results
        if not results:
            return context

        conversation = [
            {"role": message.role, "content": message.content[-4000:]}
            for message in request.messages[-6:]
            if message.role in {"user", "assistant"}
        ]
        user_messages = [
            message for message in conversation if message["role"] == "user"
        ]
        if not user_messages:
            return context

        search_query = request.extra.get("search_query")
        if not isinstance(search_query, str) or not search_query.strip():
            search_query = user_messages[-1]["content"]
        search_config = getattr(self, "_search_config", SearchConfig())

        filtered_results: list[SearchResult] = []
        try:
            candidates = [
                {
                    "id": index,
                    "title": result.title,
                    "snippet": result.content,
                    "published_date": result.published_date,
                }
                for index, result in enumerate(results, start=1)
            ]
            screening_response = await self._call_backend(
                provider=context.provider,
                model_id=context.model_name,
                messages=[
                    {"role": "system", "content": SEARCH_RELEVANCE_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "conversation": conversation,
                                "search_results": candidates,
                                "max_results": search_config.max_results,
                            },
                            ensure_ascii=False,
                        ),
                    },
                ],
                temperature=0,
                max_tokens=120,
                stream=False,
                extra={},
                api_token=context.api_token,
                client=client,
                think=False,
            )
            choices = screening_response.get("choices")
            screening_text = ""
            if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                message = choices[0].get("message")
                if isinstance(message, dict) and isinstance(message.get("content"), str):
                    screening_text = message["content"]
            relevant_ids = parse_search_relevance(
                screening_text,
                result_count=len(results),
                limit=search_config.max_results,
            )
            if relevant_ids is None:
                log.warning("AI web-search relevance screening returned invalid output.")
            else:
                filtered_results = [results[result_id - 1] for result_id in relevant_ids]
        except Exception:
            log.exception("Automatic web-search relevance screening failed.")

        context.search_results = filtered_results
        search_query = request.extra.get("search_query")
        if not isinstance(search_query, str) or not search_query.strip():
            search_query = user_messages[-1]["content"]
        for message in context.messages:
            if (
                message.get("role") == "system"
                and isinstance(message.get("content"), str)
                and message["content"].startswith("SearXNG search results for:")
            ):
                message["content"] = format_search_context(search_query, filtered_results)
                break
        return context

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

    async def available_models(
        self,
        *,
        refresh: bool = False,
        include_disabled: bool = False,
    ) -> list[dict[str, object]]:
        """Discover models, optionally including entries disabled in Model Manager."""
        return await self.model_manager.available_models(
            refresh=refresh,
            include_disabled=include_disabled,
        )

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
        strict_model = req_extra.get("strict_model") is True

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
            planning_extra = dict(req_extra)
            planning_extra.pop("tools", None)
            planning_extra.pop("search_query", None)
            planning_extra.pop("search_skill", None)
            planning_extra.pop("strict_model", None)
            planning_request = self._request_with_extra(request, planning_extra)
            context = await self.model_manager.resolve(planning_request)
            client = await self._get_client()
            if strict_model:
                request = self._request_with_extra(request, planning_extra)
                req_extra = request.extra
            else:
                request, context = await self._plan_search(request, context, client)
                req_extra = request.extra

            # Analyze complexity and decide provider candidates
            decision = await self.dispatcher.dispatch(
                messages=req_messages,
                requested_provider=req_provider or context.provider_name,
                requested_model=req_model or context.model_name,
            )
            if strict_model:
                decision.fallback_providers.clear()

            async def _execute_provider(p_name: str, m_name: str | None) -> tuple[dict[str, Any], ModelContext]:
                if strict_model and (p_name != req_provider or m_name != req_model):
                    raise RuntimeError("The requested provider/model is unavailable.")
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
                        platform=platform,
                        extra=req_extra,
                        session=getattr(request, "session", None),
                    )
                    active_context = await self.model_manager.resolve(alt_req)
                    active_context = await self._screen_search_results(
                        alt_req,
                        active_context,
                        client,
                    )
                if strict_model and (
                    active_context.provider_name != req_provider
                    or active_context.model_name != req_model
                ):
                    raise RuntimeError("The requested provider/model is unavailable.")

                explicit_think = req_extra.get("think")
                if explicit_think is True or explicit_think in ("true", "True", "1", "on"):
                    think_flag = True
                elif explicit_think is False or explicit_think in ("false", "False", "0", "off"):
                    think_flag = False
                else:
                    think_flag = should_enable_thinking(decision.complexity, model_name=active_context.model_name)

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
                    think=think_flag,
                )
                return raw, active_context

            (raw_response, final_context), effective_provider = await self.dispatcher.execute_with_failover(
                decision,
                _execute_provider,
            )

            response = self._parse_response(
                raw_response, effective_provider, final_context.model_name
            )
            response.context_length = final_context.context_length
            response.sources = [
                {"url": result.url, "title": result.title}
                for result in getattr(final_context, "search_results", [])
            ]
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
        on_thinking: Callable[[str], Awaitable[None]] | None = None,
    ) -> InferenceResponse:
        """Stream model deltas to a callback and return the completed response."""
        start_time = time.perf_counter()
        platform = getattr(request, "platform", "unknown")
        req_model = getattr(request, "model", None)
        req_provider = getattr(request, "provider_name", None)
        req_extra = getattr(request, "extra", {})
        req_messages = getattr(request, "messages", [])

        explicit_think = req_extra.get("think")
        if explicit_think is True or explicit_think in ("true", "True", "1", "on"):
            enable_thinking = True
        elif explicit_think is False or explicit_think in ("false", "False", "0", "off"):
            enable_thinking = False
        else:
            enable_thinking = should_enable_thinking(
                analyze_task_complexity(req_messages),
                model_name=req_model,
            )

        await self.broker.publish(
            "inference.stream.started",
            {
                "platform": platform,
                "model": req_model,
                "provider": req_provider,
                "think": enable_thinking,
            },
        )

        try:
            planning_extra = dict(req_extra)
            planning_extra.pop("tools", None)
            planning_extra.pop("search_query", None)
            planning_extra.pop("search_skill", None)
            planning_request = self._request_with_extra(request, planning_extra)
            context = await self.model_manager.resolve(planning_request)
            client = await self._get_client()
            request, context = await self._plan_search(request, context, client)
            req_extra = request.extra
            if explicit_think is None and not enable_thinking:
                if should_enable_thinking(analyze_task_complexity(req_messages), model_name=context.model_name):
                    enable_thinking = True
            content, thinking, usage, finish_reason, actual_model = await self._stream_backend(
                provider=context.provider,
                model_id=context.model_name,
                messages=context.messages,
                temperature=context.temperature,
                max_tokens=context.max_tokens,
                extra=req_extra,
                client=client,
                api_token=context.api_token,
                on_delta=on_delta,
                on_thinking=on_thinking,
                think=enable_thinking,
            )
            response = InferenceResponse(
                content=content,
                model=actual_model,
                provider=context.provider_name,
                prompt_tokens=usage.get("prompt_tokens", 0),
                completion_tokens=usage.get("completion_tokens", 0),
                finish_reason=finish_reason,
                thinking=thinking,
                raw={"stream": True},
                context_length=context.context_length,
                sources=[
                    {"url": result.url, "title": result.title}
                    for result in getattr(context, "search_results", [])
                ],
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
    def _chat_url(provider: BaseProvider) -> str:
        base = provider.endpoint.base_url.rstrip("/")
        if provider.name == "ollama":
            return f"{base}/v1/chat/completions"
        return f"{base}/chat/completions"

    @staticmethod
    def _chat_payload(
        provider: BaseProvider,
        model_id: str,
        messages: list[dict[str, Any]],
        temperature: float,
        max_tokens: int | None,
        extra: dict[str, Any],
        *,
        stream: bool,
        think: bool,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature,
            "stream": stream,
            **extra,
        }
        if stream:
            stream_options = dict(payload.get("stream_options") or {})
            stream_options["include_usage"] = True
            payload["stream_options"] = stream_options
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        explicit_think = "think" in extra
        payload.pop("think", None)
        payload.pop("tools", None)
        payload.pop("search_query", None)
        payload.pop("search_skill", None)
        if provider.name == "ollama":
            if "gemma" in model_id.lower():
                payload.pop("reasoning_effort", None)
            else:
                payload["reasoning_effort"] = "medium" if think else "none"
        elif hasattr(provider, "supports_thinking"):
            if getattr(provider, "supports_thinking"):
                payload["reasoning_effort"] = "medium" if think else "none"
            else:
                payload.pop("reasoning_effort", None)
                payload.pop("chat_template_kwargs", None)
        elif think or explicit_think:
            template = dict(payload.get("chat_template_kwargs") or {})
            template["enable_thinking"] = think
            payload["chat_template_kwargs"] = template
        return payload

    @staticmethod
    async def _call_backend(
        provider: BaseProvider,
        model_id: str,
        messages: list[dict[str, Any]],
        temperature: float,
        max_tokens: int | None,
        stream: bool,
        extra: dict[str, Any],
        client: httpx.AsyncClient,
        api_token: str | None = None,
        think: bool = False,
    ) -> dict[str, Any]:
        """POST to the provider's chat/completions endpoint."""
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        payload = Router._chat_payload(
            provider,
            model_id,
            messages,
            temperature,
            max_tokens,
            extra,
            stream=stream,
            think=think,
        )
        headers = {"Authorization": f"Bearer {api_token}"} if api_token else None
        resp = await client.post(
            Router._chat_url(provider),
            json=payload,
            headers=headers,
        )
        if provider.name == "ollama" and getattr(resp, "status_code", None) == 404:
            options: dict[str, Any] = {}
            if temperature is not None:
                options["temperature"] = temperature
            if max_tokens is not None:
                options["num_predict"] = max_tokens
            native_messages: list[dict[str, Any]] = []
            for message in messages:
                content = message["content"]
                if not isinstance(content, list):
                    native_messages.append(message)
                    continue
                text_parts = [
                    part["text"] for part in content
                    if isinstance(part, dict)
                    and part.get("type") == "text"
                    and isinstance(part.get("text"), str)
                ]
                images = [
                    part["image_url"]["url"].split(",", 1)[1]
                    for part in content
                    if isinstance(part, dict)
                    and part.get("type") == "image_url"
                    and isinstance(part.get("image_url"), dict)
                    and isinstance(part["image_url"].get("url"), str)
                    and part["image_url"]["url"].startswith("data:image/")
                    and "," in part["image_url"]["url"]
                ]
                native_message: dict[str, Any] = {
                    "role": message["role"],
                    "content": "\n".join(text_parts),
                }
                if images:
                    native_message["images"] = images
                native_messages.append(native_message)
            native_payload: dict[str, Any] = {
                "model": model_id,
                "messages": native_messages,
                "stream": False,
                "options": options,
                "think": think,
            }
            resp = await client.post(
                f"{provider.endpoint.base_url.rstrip('/')}/api/chat",
                json=native_payload,
                headers=headers,
            )
        if provider.name == "ollama" and getattr(resp, "status_code", None) == 404:
            try:
                error_data = resp.json()
            except ValueError:
                error_data = None
            if isinstance(error_data, dict):
                detail = error_data.get("error")
                if isinstance(detail, str) and detail:
                    raise RuntimeError(
                        f"Ollama could not run model '{model_id}': {detail}"
                    )
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = ""
            try:
                error_data = resp.json()
            except ValueError:
                error_data = None
            if isinstance(error_data, dict):
                error = error_data.get("error")
                if isinstance(error, dict):
                    error = error.get("message")
                if isinstance(error, str):
                    detail = error.strip()
            if not detail:
                detail = str(getattr(resp, "text", "")).strip()
            if detail:
                detail = detail[:500]
                raise RuntimeError(
                    f"{provider.name} model '{model_id}' returned HTTP "
                    f"{resp.status_code}: {detail}"
                ) from exc
            raise
        data = resp.json()
        if provider.name == "ollama" and "message" in data:
            return {
                "model": data.get("model", model_id),
                "choices": [{
                    "message": data.get("message", {}),
                    "finish_reason": data.get("done_reason", "stop"),
                }],
                "usage": {
                    "prompt_tokens": data.get("prompt_eval_count", 0),
                    "completion_tokens": data.get("eval_count", 0),
                },
            }
        return data

    @staticmethod
    async def _stream_backend(
        provider: BaseProvider,
        model_id: str,
        messages: list[dict[str, Any]],
        temperature: float,
        max_tokens: int | None,
        extra: dict[str, Any],
        client: httpx.AsyncClient,
        api_token: str | None,
        on_delta: Callable[[str], Awaitable[None]],
        on_thinking: Callable[[str], Awaitable[None]] | None = None,
        think: bool = False,
    ) -> tuple[str, str, dict[str, int], str, str]:
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        payload = Router._chat_payload(
            provider,
            model_id,
            messages,
            temperature,
            max_tokens,
            extra,
            stream=True,
            think=think,
        )
        headers = {"Authorization": f"Bearer {api_token}"} if api_token else None

        content_parts: list[str] = []
        thinking_parts: list[str] = []
        tag_parser = _ThinkTagParser()
        usage = {"prompt_tokens": 0, "completion_tokens": 0}
        finish_reason = "stop"
        actual_model = model_id
        terminal_received = False
        stream_timeout = httpx.Timeout(connect=10, read=None, write=30, pool=10)

        async def emit_thinking(text: str) -> None:
            if not text:
                return
            thinking_parts.append(text)
            if on_thinking is not None:
                await on_thinking(text)

        async with client.stream(
            "POST",
            Router._chat_url(provider),
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
                if provider.name != "ollama":
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
                message = choice.get("message")
                if isinstance(delta, dict):
                    source = delta
                elif isinstance(message, dict):
                    source = message
                else:
                    source = {}
                await emit_thinking(_reasoning_text(source))
                raw_content = source.get("content") if isinstance(source, dict) else None
                if not isinstance(raw_content, str) or not raw_content:
                    continue
                visible, tagged = tag_parser.feed(raw_content)
                await emit_thinking(tagged)
                if visible:
                    content_parts.append(visible)
                    await on_delta(visible)
        leftover_visible, leftover_think = tag_parser.flush()
        await emit_thinking(leftover_think)
        if leftover_visible:
            content_parts.append(leftover_visible)
            await on_delta(leftover_visible)
        if not terminal_received:
            raise RuntimeError("The model stream ended before the response was complete.")
        return (
            "".join(content_parts),
            "".join(thinking_parts),
            usage,
            str(finish_reason),
            actual_model,
        )

    @staticmethod
    def _parse_response(raw: dict[str, Any], provider: str, model: str) -> InferenceResponse:
        """Normalise the OpenAI-compatible JSON response into InferenceResponse."""
        choices: list[dict[str, Any]] = raw.get("choices", [])
        content = ""
        thinking = ""
        finish_reason = "stop"
        if choices:
            first = choices[0]
            msg = first.get("message", {})
            if not isinstance(msg, dict):
                msg = {}
            content = msg.get("content", "") or ""
            thinking = _reasoning_text(msg)
            visible, tagged = _ThinkTagParser.split_complete(content)
            content = visible
            thinking = f"{thinking}{tagged}"
            finish_reason = first.get("finish_reason", "stop") or "stop"

        usage: dict[str, Any] = raw.get("usage", {})
        return InferenceResponse(
            content=content,
            model=model if provider == "ollama" else raw.get("model", model),
            provider=provider,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            finish_reason=finish_reason,
            thinking=thinking,
            raw=raw,
        )


def _reasoning_text(payload: dict[str, Any]) -> str:
    for key in ("reasoning", "reasoning_content", "thinking", "thoughts"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


class _ThinkTagParser:
    """Split streamed ``<think>`` blocks from user-visible content."""

    _OPEN = "<think>"
    _CLOSE = "</think>"

    def __init__(self) -> None:
        self._buffer = ""
        self._in_think = False

    def feed(self, piece: str) -> tuple[str, str]:
        if not piece:
            return "", ""
        self._buffer += piece
        content: list[str] = []
        thinking: list[str] = []
        while self._buffer:
            needle = self._CLOSE if self._in_think else self._OPEN
            index = self._buffer.lower().find(needle)
            if index == -1:
                keep = _partial_tag_suffix(self._buffer, needle)
                emit = self._buffer[:-keep] if keep else self._buffer
                self._buffer = self._buffer[-keep:] if keep else ""
                if emit:
                    (thinking if self._in_think else content).append(emit)
                break
            before = self._buffer[:index]
            if before:
                (thinking if self._in_think else content).append(before)
            self._buffer = self._buffer[index + len(needle):]
            self._in_think = not self._in_think
        return "".join(content), "".join(thinking)

    def flush(self) -> tuple[str, str]:
        leftover = self._buffer
        self._buffer = ""
        if not leftover:
            return "", ""
        if self._in_think:
            return "", leftover
        return leftover, ""

    @classmethod
    def split_complete(cls, text: str) -> tuple[str, str]:
        parser = cls()
        visible, thinking = parser.feed(text)
        leftover_visible, leftover_think = parser.flush()
        return visible + leftover_visible, thinking + leftover_think


def _partial_tag_suffix(buffer: str, tag: str) -> int:
    lowered = buffer.lower()
    max_keep = min(len(buffer), len(tag) - 1)
    for size in range(max_keep, 0, -1):
        if tag.startswith(lowered[-size:]):
            return size
    return 0

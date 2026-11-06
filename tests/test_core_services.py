from __future__ import annotations

import asyncio
import os
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import patch

import httpx

from core.model import ModelContext, ModelManager
from core.memory import MemoryStore
from core.session import Session, SessionStore
from core.session_manager import SessionManager
from router.router import Router
from src.provider import (
    LlamaCppProvider,
    LMStudioProvider,
    ModelInfo,
    OllamaProvider,
    detect_supports_thinking,
    detect_supports_vision,
)
from src.provider.base import ModelLimits
from src.tools.search import SearchResult
from src import discord_bridge


class FakeProvider:
    name = "ollama"

    def __init__(self) -> None:
        self.list_calls = 0

    async def ping(self) -> bool:
        return True

    async def list_models(self) -> list[ModelInfo]:
        self.list_calls += 1
        return [ModelInfo(id="llama-test")]

    async def get_model(self, model_id: str) -> ModelInfo | None:
        if model_id != "llama-test":
            return None
        return ModelInfo(id=model_id, limits=ModelLimits(context_length=65536))


class FakeDatabase:
    def __init__(self) -> None:
        now = datetime.now(timezone.utc)
        self.record = {
            "session_id": 7,
            "platform": "discord",
            "conversation_id": "thread-1",
            "user_id": "user-1",
            "status": "active",
            "metadata": {"guild_id": "guild-1"},
            "created_at": now,
            "updated_at": now,
            "last_message_at": None,
        }
        self.queries: list[tuple[str, tuple[object, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, query: str, *args: object) -> dict[str, object]:
        self.queries.append((query, args))
        if "UPDATE chat_sessions" in query:
            self.record["status"] = args[2] or self.record["status"]
            return dict(self.record)
        if "WITH inserted AS" in query:
            return {"inserted": True}
        if "INSERT INTO chat_sessions" in query:
            return dict(self.record)
        if "SELECT session_id, platform" in query:
            return dict(self.record)
        raise AssertionError(f"Unexpected query: {query}")

    async def execute(self, query: str, *args: object) -> str:
        self.execute_calls.append((query, args))
        return "UPDATE 1"


class FakeMemoryDatabase:
    def __init__(self) -> None:
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, query: str, *args: object) -> dict[str, int]:
        self.fetchrow_calls.append((query, args))
        return {"memory_id": 1}

    async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
        self.fetch_calls.append((query, args))
        return [
            {"content": "User asked: Discord bot setup\nZEUS answered: Create a bot project.", "relevance": 0.4},
        ]

    async def execute(self, query: str, *args: object) -> str:
        self.fetch_calls.append((query, args))
        return "DELETE 2" if "conversation_memories" in query else "DELETE 0"


class FakeSearchClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    async def search(self, query: str, *, limit: int = 6) -> list[SearchResult]:
        self.calls.append((query, limit))
        return [
            SearchResult(
                title="Official research",
                url="https://example.test/research",
                content="A verified search snippet.",
                engine="test",
                published_date="2026-07-20",
            )
        ]


class ModelManagerTests(unittest.IsolatedAsyncioTestCase):
    def test_model_capability_detection_uses_metadata_and_known_ids(self) -> None:
        self.assertTrue(detect_supports_vision(
            "unknown-model",
            {"input_modalities": ["text", "image"]},
        ))
        self.assertFalse(detect_supports_vision(
            "llava-model",
            {"supports_vision": False},
        ))
        self.assertTrue(detect_supports_thinking(
            "unknown-model",
            {"supported_parameters": ["reasoning_effort"]},
        ))
        self.assertTrue(detect_supports_thinking("deepseek-r1:latest"))
        self.assertFalse(detect_supports_thinking("plain-chat-model"))

    async def test_disabled_local_models_remain_in_catalog_and_are_rejected(self) -> None:
        class AvailableProvider:
            def __init__(self, name: str) -> None:
                self.name = name
                self.endpoint = SimpleNamespace(base_url="http://localhost:11434")

            async def ping(self) -> bool:
                return self.name == "ollama"

            async def list_models(self) -> list[ModelInfo]:
                return [ModelInfo(id="local-model"), ModelInfo(id="deleted-model")]

            async def get_model(self, model_id: str) -> ModelInfo | None:
                return ModelInfo(id=model_id) if model_id in {"local-model", "deleted-model"} else None

        class ControlsDatabase:
            async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
                if "FROM model_controls" in query:
                    if "WHERE provider_name = $1 AND enabled = FALSE" in query:
                        return [{"model_id": "local-model"}, {"model_id": "deleted-model"}]
                    return [{
                        "provider_name": "ollama",
                        "model_id": "local-model",
                        "enabled": False,
                        "supports_vision": None,
                        "supports_thinking": None,
                    }, {
                        "provider_name": "ollama",
                        "model_id": "deleted-model",
                        "enabled": False,
                        "deleted": True,
                    }]
                return []

            async def fetchrow(
                self,
                query: str,
                *args: object,
            ) -> dict[str, object] | None:
                if "FROM model_controls" in query:
                    return {"enabled": False}
                return None

        manager = ModelManager(
            provider_factory=lambda name: AvailableProvider(name),  # type: ignore[arg-type]
            database=ControlsDatabase(),
        )

        self.assertEqual(await manager.available_models(), [])
        catalog = await manager.available_models(include_disabled=True)
        self.assertEqual(
            [model["model"] for model in catalog],
            ["local-model", "deleted-model"],
        )
        self.assertFalse(catalog[1]["enabled"])
        with self.assertRaisesRegex(ValueError, "disabled"):
            await manager.resolve(SimpleNamespace(
                provider_name="ollama",
                model="deleted-model",
                messages=[SimpleNamespace(role="user", content="hello")],
                temperature=None,
                max_tokens=None,
                session=None,
            ))

    async def test_model_discovery_checks_providers_concurrently(self) -> None:
        names = ("ollama", "lmstudio", "llamacpp")
        providers_started = 0
        all_providers_started = asyncio.Event()

        class ConcurrentProvider:
            def __init__(self, name: str) -> None:
                self.name = name

            async def ping(self) -> bool:
                nonlocal providers_started
                providers_started += 1
                if providers_started == len(names):
                    all_providers_started.set()
                await asyncio.wait_for(all_providers_started.wait(), timeout=1)
                return True

            async def list_models(self) -> list[ModelInfo]:
                return [ModelInfo(id=f"{self.name}-model")]

        manager = ModelManager(
            provider_factory=lambda name: ConcurrentProvider(name),  # type: ignore[arg-type]
        )

        models = await manager.available_models()

        self.assertEqual(
            models,
            [
                {"provider": name, "model": f"{name}-model"}
                for name in names
            ],
        )

    async def test_runtime_status_reports_configured_provider_and_loaded_model(self) -> None:
        provider = FakeProvider()
        manager = ModelManager(provider_factory=lambda _: provider)

        with patch.dict(os.environ, {"ZEUS_PROVIDER": "ollama"}):
            status = await manager.status()

        self.assertEqual(status["provider"], "ollama")
        self.assertEqual(status["model"], "llama-test")
        self.assertEqual(status["context_length"], 65536)
        self.assertEqual(manager.cache_status()["misses"], 1)

    async def test_selected_model_fetches_detailed_context_metadata(self) -> None:
        provider = FakeProvider()
        manager = ModelManager(provider_factory=lambda _: provider)
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[SimpleNamespace(role="user", content="hello")],
            temperature=None,
            max_tokens=None,
            session=None,
        )

        context = await manager.resolve(request)
        status = await manager.status()

        self.assertEqual(context.context_length, 65536)
        self.assertEqual(status["context_length"], 65536)

    async def test_research_request_searches_and_adds_bounded_source_context(self) -> None:
        search = FakeSearchClient()
        manager = ModelManager(
            provider_factory=lambda _: FakeProvider(),
            search_client=search,
        )
        question = "Please research how SearXNG returns JSON results."
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[SimpleNamespace(role="user", content=question)],
            extra={"tools": ["search"], "search_skill": "deep-research"},
            temperature=None,
            max_tokens=None,
            session=None,
        )

        context = await manager.resolve(request)

        self.assertEqual(search.calls[0], (question, 10))
        research_message = next(
            message
            for message in context.messages
            if "SearXNG search results" in message["content"]
        )
        self.assertIn("https://example.test/research", research_message["content"])
        self.assertIn("Published: 2026-07-20", research_message["content"])
        self.assertIn("Current date:", research_message["content"])
        self.assertIn("Pretrained knowledge may be outdated", research_message["content"])
        self.assertIn("untrusted external data", research_message["content"])
        self.assertIn("Start with the answer itself", research_message["content"])
        self.assertIn("clickable source links in the answer footer", research_message["content"])
        self.assertIn("# Active skill: Deep Research", context.messages[0]["content"])

    async def test_search_failure_is_disclosed_without_blocking_inference(self) -> None:
        class OfflineSearchClient:
            async def search(self, query: str, *, limit: int = 6) -> list[SearchResult]:
                raise httpx.ConnectError("offline")

        manager = ModelManager(
            provider_factory=lambda _: FakeProvider(),
            search_client=OfflineSearchClient(),
        )
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[
                SimpleNamespace(role="user", content="Research current SearXNG features.")
            ],
            extra={"tools": ["search"]},
            temperature=None,
            max_tokens=None,
            session=None,
        )

        context = await manager.resolve(request)

        search_message = next(
            message
            for message in context.messages
            if "Automatic web search could not be completed" in message["content"]
        )
        self.assertIn("do not invent citations", search_message["content"])

    async def test_follow_up_does_not_repeat_search_for_an_older_research_prompt(self) -> None:
        search = FakeSearchClient()
        manager = ModelManager(
            provider_factory=lambda _: FakeProvider(),
            search_client=search,
        )
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[
                SimpleNamespace(role="user", content="Research SearXNG JSON results."),
                SimpleNamespace(role="assistant", content="Here is a sourced overview."),
                SimpleNamespace(role="user", content="Can you clarify that last point?"),
            ],
            temperature=None,
            max_tokens=None,
            session=None,
        )

        await manager.resolve(request)

        self.assertEqual(search.calls, [])

    async def test_research_prompt_does_not_search_without_explicit_tool_selection(self) -> None:
        search = FakeSearchClient()
        manager = ModelManager(
            provider_factory=lambda _: FakeProvider(),
            search_client=search,
        )
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[
                SimpleNamespace(role="user", content="Please research current SearXNG features.")
            ],
            temperature=None,
            max_tokens=None,
            session=None,
        )

        context = await manager.resolve(request)

        self.assertEqual(search.calls, [])
        self.assertFalse(any(
            "SearXNG search results" in message["content"]
            for message in context.messages
        ))

    async def test_quick_search_includes_enough_results_to_reach_relevant_sources(self) -> None:
        search = FakeSearchClient()
        manager = ModelManager(
            provider_factory=lambda _: FakeProvider(),
            search_client=search,
        )
        question = (
            "Bạn có thể tìm kiếm thông tin về World Cup 2026 và ai thắng đi"
        )
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[SimpleNamespace(role="user", content=question)],
            extra={"tools": ["search"]},
            temperature=None,
            max_tokens=None,
            session=None,
        )

        await manager.resolve(request)

        self.assertEqual(search.calls[0], (question, 10))

    async def test_selected_model_uses_its_own_context_window(self) -> None:
        class DifferentContextProvider(FakeProvider):
            async def get_model(self, model_id: str) -> ModelInfo | None:
                context_lengths = {"small-model": 8192, "large-model": 131072}
                context_length = context_lengths.get(model_id)
                if context_length is None:
                    return None
                return ModelInfo(
                    id=model_id,
                    limits=ModelLimits(context_length=context_length),
                )

        manager = ModelManager(provider_factory=lambda _: DifferentContextProvider())
        contexts = []
        for model_name in ("small-model", "large-model"):
            request = SimpleNamespace(
                provider_name="ollama",
                model=model_name,
                messages=[SimpleNamespace(role="user", content="hello")],
                temperature=None,
                max_tokens=None,
                session=None,
            )
            contexts.append(await manager.resolve(request))

        self.assertEqual(
            [context.context_length for context in contexts],
            [8192, 131072],
        )

    async def test_bridge_status_reads_runtime_and_session_usage_from_core(self) -> None:
        now = datetime.now(timezone.utc)
        requested_session: dict[str, str] = {}

        class FakeSessionManager:
            async def get_session(self, platform: str, conversation_id: str) -> Session:
                requested_session.update(platform=platform, conversation_id=conversation_id)
                return Session(
                    session_id=17,
                    platform=platform,
                    conversation_id=conversation_id,
                    user_id="user-1",
                    status="active",
                    metadata={"usage": {
                        "prompt_tokens": 1200,
                        "completion_tokens": 180,
                        "last_prompt_tokens": 900,
                        "last_completion_tokens": 180,
                        "provider": "ollama",
                        "model": "qwen-test",
                        "context_length": 32768,
                    }},
                    created_at=now,
                    updated_at=now,
                    last_message_at=now,
                )

            async def get_usage(
                self,
                platform: str,
                conversation_id: str,
            ) -> dict[str, int]:
                self_test.assertEqual((platform, conversation_id), ("discord", "thread-status"))
                return {"prompt_tokens": 5400, "completion_tokens": 590}

        class FakeModelManager:
            async def status(self) -> dict[str, str | int | None]:
                return {
                    "provider": "ollama",
                    "model": "qwen-test",
                    "context_length": 32768,
                }

            def cache_status(self) -> dict[str, int]:
                return {"hits": 8, "misses": 2, "cached_models": 1}

        class FakeRouter:
            model_manager = FakeModelManager()

        class FakeAgentRunner:
            def status(self) -> dict[str, object]:
                return {"collecting": True, "queue_depth": 2, "last_result": None}

        responses: list[dict[str, object]] = []

        async def send(event: dict[str, object]) -> None:
            responses.append(event)

        self_test = self
        with (
            patch.object(discord_bridge, "_session_manager", FakeSessionManager()),
            patch.object(discord_bridge, "_router", FakeRouter()),
            patch.object(discord_bridge, "_agent_runner", FakeAgentRunner()),
            patch.object(discord_bridge, "_version", return_value="1.0.0.test"),
            patch.object(discord_bridge, "_BRIDGE_TOKEN", "test-bridge-token"),
        ):
            await discord_bridge.BridgeApplication()._http(
                {
                    "type": "http",
                    "method": "GET",
                    "path": "/status",
                    "query_string": b"platform=discord&conversation_id=thread-status",
                    "headers": [(b"authorization", b"Bearer test-bridge-token")],
                },
                AsyncMock(),
                send,
            )

        payload = json.loads(responses[-1]["body"])
        self.assertEqual(requested_session, {
            "platform": "discord",
            "conversation_id": "thread-status",
        })
        self.assertEqual(payload["model"]["model"], "qwen-test")
        self.assertEqual(payload["session"]["prompt_tokens"], 5400)
        self.assertEqual(payload["session"]["last_prompt_tokens"], 900)
        self.assertEqual(payload["session"]["id"], 17)
        self.assertEqual(payload["model_cache"]["hits"], 8)

    async def test_model_cache_context_and_provider_token(self) -> None:
        provider = FakeProvider()
        def provider_factory(name: str) -> FakeProvider:
            self.assertEqual(name, "ollama")
            return provider

        manager = ModelManager(provider_factory=provider_factory)
        request = SimpleNamespace(
            provider_name="ollama",
            model=None,
            messages=[SimpleNamespace(role="user", content="hello")],
            temperature=None,
            max_tokens=None,
            session=None,
        )
        with patch.dict(os.environ, {"OLLAMA_API_KEY": "test-secret"}):
            first = await manager.resolve(request)
            second = await manager.resolve(request)

        self.assertEqual(first.model_name, "llama-test")
        self.assertEqual(first.api_token, "test-secret")
        self.assertEqual(first.messages[-1]["content"], "hello")
        self.assertEqual(provider.list_calls, 1)
        self.assertEqual(second.model_name, first.model_name)
        self.assertNotIn("test-secret", repr(first))

        manager.invalidate("ollama")
        await manager.resolve(request)
        self.assertEqual(provider.list_calls, 2)

    async def test_configured_model_is_used_when_request_has_no_model(self) -> None:
        provider = FakeProvider()
        manager = ModelManager(provider_factory=lambda _: provider)
        request = SimpleNamespace(
            provider_name="ollama",
            model=None,
            messages=[SimpleNamespace(role="user", content="hello")],
            temperature=None,
            max_tokens=None,
            session=None,
        )

        with patch.dict(os.environ, {"ZEUS_MODEL": "configured-model"}):
            context = await manager.resolve(request)

        self.assertEqual(context.model_name, "configured-model")
        self.assertEqual(provider.list_calls, 0)

    async def test_automatic_model_setting_uses_runtime_discovery(self) -> None:
        provider = FakeProvider()
        manager = ModelManager(provider_factory=lambda _: provider)
        request = SimpleNamespace(
            provider_name="ollama",
            model=None,
            messages=[SimpleNamespace(role="user", content="hello")],
            temperature=None,
            max_tokens=None,
            session=None,
        )

        with patch.dict(os.environ, {"ZEUS_MODEL": "automatic"}):
            context = await manager.resolve(request)

        self.assertEqual(context.model_name, "llama-test")
        self.assertEqual(provider.list_calls, 1)

    async def test_memory_is_added_to_context_without_replacing_soul(self) -> None:
        provider = FakeProvider()
        database = FakeMemoryDatabase()
        memory = MemoryStore(database)  # type: ignore[arg-type]

        def provider_factory(name: str) -> FakeProvider:
            self.assertEqual(name, "ollama")
            return provider

        manager = ModelManager(
            provider_factory=provider_factory,
            memory_store=memory,
        )
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[SimpleNamespace(role="user", content="How do I add a Discord bot command?")],
            temperature=None,
            max_tokens=None,
            session=SimpleNamespace(
                platform="discord",
                user_id="private-user",
                conversation_id="new-thread",
            ),
        )

        context = await manager.resolve(request)
        self.assertEqual(context.messages[0]["role"], "system")
        self.assertIn("ZEUS", context.messages[0]["content"])
        self.assertIn("Safety", context.messages[0]["content"])
        self.assertIn("Skill workflow", context.messages[0]["content"])
        self.assertEqual(context.messages[1]["role"], "user")
        self.assertIn("Relevant memories", context.messages[1]["content"])
        self.assertIn("Discord bot setup", context.messages[1]["content"])
        self.assertEqual(context.messages[2]["content"], "How do I add a Discord bot command?")
        self.assertEqual(database.fetch_calls[0][1][0:2], ("discord", "private-user"))
        self.assertEqual(database.fetch_calls[0][1][2], "add | discord | bot | command")

    async def test_adaptive_search_retries_only_after_weak_first_pass(self) -> None:
        class AdaptiveClient:
            def __init__(self) -> None:
                self.calls: list[str] = []

            async def search(self, query: str, *, limit: int = 6) -> list[SearchResult]:
                self.calls.append(query)
                if len(self.calls) == 1:
                    return [SearchResult("Unrelated", "https://one.test/", "news", "test")]
                return [
                    SearchResult(
                        "ZEUS asynchronous stream API",
                        "https://two.test/",
                        "ZEUS stream API changed its async behavior",
                        "test",
                    )
                ]

        search = AdaptiveClient()
        manager = ModelManager(
            provider_factory=lambda _: FakeProvider(),
            search_client=search,
        )
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[SimpleNamespace(
                role="user",
                content="What changed in ZEUS asynchronous stream API?",
            )],
            extra={"tools": ["search"]},
            temperature=None,
            max_tokens=None,
            session=None,
        )

        context = await manager.resolve(request)

        self.assertEqual(len(search.calls), 2)
        self.assertNotEqual(search.calls[0], search.calls[1])
        self.assertEqual(context.search_results[0].url, "https://two.test/")

    async def test_optional_memory_failure_does_not_block_inference(self) -> None:
        class UnavailableMemory:
            async def retrieve(self, **kwargs: str) -> list[str]:
                raise RuntimeError("unavailable")

        manager = ModelManager(
            provider_factory=lambda _: FakeProvider(),
            memory_store=UnavailableMemory(),  # type: ignore[arg-type]
        )
        request = SimpleNamespace(
            provider_name="ollama",
            model="llama-test",
            messages=[SimpleNamespace(role="user", content="What is relevant?")],
            extra={},
            temperature=None,
            max_tokens=None,
            session=SimpleNamespace(
                platform="discord",
                user_id="user-1",
                conversation_id="thread-1",
            ),
        )

        context = await manager.resolve(request)

        self.assertEqual(context.model_name, "llama-test")
        self.assertEqual(context.messages[-1]["content"], "What is relevant?")

    async def test_router_sends_optional_provider_token_as_bearer_auth(self) -> None:
        captured: dict[str, object] = {}

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict[str, object]:
                return {"choices": []}

        class FakeClient:
            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(
                self,
                exc_type: object,
                exc_value: object,
                traceback: object,
            ) -> None:
                _ = (exc_type, exc_value, traceback)
                return None

            async def post(self, url: str, **kwargs: object) -> FakeResponse:
                captured["url"] = url
                captured.update(kwargs)
                return FakeResponse()

        def async_client_factory(**kwargs: object) -> FakeClient:
            self.assertEqual(kwargs, {"timeout": 120})
            return FakeClient()

        class FakeHttpx:
            AsyncClient = staticmethod(async_client_factory)

        with patch("router.router.httpx", FakeHttpx):
            await Router._call_backend(
                provider=SimpleNamespace(
                    name="ollama",
                    endpoint=SimpleNamespace(base_url="http://localhost:11434"),
                ),  # type: ignore[arg-type]
                model_id="llama-test",
                messages=[{"role": "user", "content": "hello"}],
                temperature=0.7,
                max_tokens=None,
                stream=False,
                extra={},
                client=FakeClient(),
                api_token="test-token",
            )

        self.assertEqual(captured["url"], "http://localhost:11434/v1/chat/completions")
        self.assertEqual(captured["headers"], {"Authorization": "Bearer test-token"})


class SessionManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_record_usage_casts_jsonb_build_object_parameters(self) -> None:
        database = FakeDatabase()
        store = SessionStore(database)  # type: ignore[arg-type]

        await store.record_usage(
            7,
            prompt_tokens=1200,
            completion_tokens=180,
            provider="ollama",
            model="qwen2.5:7b",
            context_length=32768,
        )

        query, args = database.execute_calls[0]
        self.assertIn("'provider', $4::TEXT", query)
        self.assertIn("'model', $5::TEXT", query)
        self.assertIn("'context_length', $6::BIGINT", query)
        self.assertEqual(args, (7, 1200, 180, "ollama", "qwen2.5:7b", 32768))

    async def test_session_lifecycle_and_message_persistence(self) -> None:
        database = FakeDatabase()
        manager = SessionManager(database)  # type: ignore[arg-type]
        session = await manager.open_session(
            "discord", "thread-1", "user-1", {"guild_id": "guild-1"},
        )
        self.assertEqual(session.session_id, 7)
        self.assertEqual(session.status, "active")

        saved = await manager.append_message({
            "platform": "discord",
            "conversation_id": "thread-1",
            "message_id": "message-1",
            "role": "user",
            "content": "hello",
            "user_id": "user-1",
        })
        self.assertTrue(saved)
        append_query = next(query for query, _ in database.queries if "WITH inserted AS" in query)
        self.assertIn("INSERT INTO chat_messages", append_query)
        self.assertIn("INSERT INTO chat_sessions", append_query)

        closed = await manager.close_session(session.session_id)
        self.assertIsNotNone(closed)
        self.assertEqual(closed.status, "closed")
        self.assertEqual(
            (await manager.get_session("discord", "thread-1")).status,
            "closed",
        )
        await manager.shutdown()

    async def test_router_saves_successful_turn_to_user_memory(self) -> None:
        now = datetime.now(timezone.utc)
        session = Session(
            session_id=14,
            platform="discord",
            conversation_id="thread-3",
            user_id="user-3",
            status="active",
            metadata={},
            created_at=now,
            updated_at=now,
            last_message_at=None,
        )
        remembered: list[dict[str, str]] = []

        class FakeMemoryStore:
            async def remember_turn(self, **kwargs: str) -> bool:
                remembered.append(kwargs)
                return True

        class FakeModelManager:
            async def resolve(self, request: object) -> ModelContext:
                assert request.session is session
                return ModelContext(
                    provider_name="ollama",
                    provider=FakeProvider(),  # type: ignore[arg-type]
                    model_name="llama-test",
                    messages=[],
                    session=session,
                )

        request = SimpleNamespace(
            messages=[
                SimpleNamespace(role="user", content="How do I add a work command?"),
            ],
            stream=False,
            extra={},
            session=session,
        )
        router = Router(
            model_manager=FakeModelManager(),  # type: ignore[arg-type]
            memory_store=FakeMemoryStore(),  # type: ignore[arg-type]
        )
        with patch.object(
            Router,
            "_call_backend",
            new=AsyncMock(return_value={
                "choices": [{"message": {"content": "Use the Discord command handler."}}],
            }),
        ):
            response = await router.route(request)

        self.assertEqual(response.content, "Use the Discord command handler.")
        self.assertEqual(remembered, [{
            "platform": "discord",
            "user_id": "user-3",
            "conversation_id": "thread-3",
            "question": "How do I add a work command?",
            "answer": "Use the Discord command handler.",
        }])

    async def test_memory_retention_refresh_and_forget_are_user_scoped(self) -> None:
        database = FakeMemoryDatabase()
        memory = MemoryStore(database)  # type: ignore[arg-type]

        await memory.remember_turn(
            platform="discord",
            user_id="user-1",
            conversation_id="thread-1",
            question="How to create a Discord bot project?",
            answer="Start a project and register commands.",
        )
        memories = await memory.retrieve(
            platform="discord",
            user_id="user-1",
            query="add a command to the Discord bot",
        )
        forgotten = await memory.forget_user(platform="discord", user_id="user-1")

        self.assertEqual(len(memories), 1)
        self.assertEqual(forgotten, 2)
        store_query, store_args = database.fetchrow_calls[0]
        self.assertIn("INTERVAL '1 day'", store_query)
        self.assertEqual(store_args[0:3], ("discord", "user-1", "thread-1"))
        retrieve_query, retrieve_args = database.fetch_calls[0]
        self.assertIn("SET expires_at = NOW()", retrieve_query)
        self.assertEqual(retrieve_args[0:2], ("discord", "user-1"))
        forget_query, forget_args = database.fetch_calls[1]
        self.assertIn("DELETE FROM conversation_memories", forget_query)
        self.assertEqual(forget_args, ("discord", "user-1"))
        extracted_forget_query, extracted_forget_args = database.fetch_calls[2]
        self.assertIn("DELETE FROM extracted_memories", extracted_forget_query)
        self.assertEqual(extracted_forget_args, ("discord", "user-1"))

    async def test_bridge_attaches_persistent_session_to_inference_request(self) -> None:
        now = datetime.now(timezone.utc)
        opened: dict[str, object] = {}
        submitted: dict[str, object] = {}

        class FakeSessionManager:
            async def open_session(self, **kwargs: object) -> Session:
                opened.update(kwargs)
                return Session(
                    session_id=11,
                    platform="discord",
                    conversation_id="thread-2",
                    user_id="user-2",
                    status="active",
                    metadata={},
                    created_at=now,
                    updated_at=now,
                    last_message_at=None,
                )

        class FakeAgentRunner:
            def submit(self, request: object) -> SimpleNamespace:
                submitted["request"] = request
                return SimpleNamespace(run_id="run-1", status="queued")

        body = {
            "provider": "ollama",
            "model": "llama-test",
            "platform": "discord",
            "session": {
                "platform": "discord",
                "conversation_id": "thread-2",
                "user_id": "user-2",
                "metadata": {"guild_id": "guild-2"},
            },
            "messages": [{"role": "user", "content": "hello"}],
        }
        events = [{
            "type": "http.request",
            "body": json.dumps(body).encode("utf-8"),
            "more_body": False,
        }]
        responses: list[dict[str, object]] = []

        async def receive() -> dict[str, object]:
            return events.pop(0)

        async def send(event: dict[str, object]) -> None:
            responses.append(event)

        with (
            patch.object(discord_bridge, "_session_manager", FakeSessionManager()),
            patch.object(discord_bridge, "_agent_runner", FakeAgentRunner()),
            patch.object(discord_bridge, "_BRIDGE_TOKEN", "test-bridge-token"),
        ):
            await discord_bridge.BridgeApplication()._http(
                {
                    "method": "POST",
                    "path": "/agent/run",
                    "headers": [(b"authorization", b"Bearer test-bridge-token")],
                },
                receive,
                send,
            )

        request = submitted["request"]
        self.assertEqual(opened["conversation_id"], "thread-2")
        self.assertEqual(request.session.session_id, 11)
        self.assertEqual(request.platform, "discord")
        self.assertEqual(responses[0]["status"], 202)


class ProviderEndpointConfigurationTests(unittest.TestCase):
    def test_shared_endpoint_is_limited_to_configured_provider(self) -> None:
        with patch.dict(os.environ, {
            "ZEUS_PROVIDER": "ollama",
            "LLM_HOST": "ollama.example",
            "LLM_PORT": "11434",
        }, clear=True):
            self.assertEqual((OllamaProvider().host, OllamaProvider().port), (
                "ollama.example",
                11434,
            ))
            self.assertEqual((LMStudioProvider().host, LMStudioProvider().port), (
                "localhost",
                1234,
            ))
            self.assertEqual((LlamaCppProvider().host, LlamaCppProvider().port), (
                "localhost",
                8080,
            ))

    def test_provider_specific_endpoint_is_used_for_non_selected_provider(self) -> None:
        with patch.dict(os.environ, {
            "ZEUS_PROVIDER": "lmstudio",
            "LLM_HOST": "lmstudio.example",
            "LLM_PORT": "1235",
            "OLLAMA_HOST": "ollama.example",
            "OLLAMA_PORT": "11435",
        }, clear=True):
            self.assertEqual((LMStudioProvider().host, LMStudioProvider().port), (
                "lmstudio.example",
                1235,
            ))
            self.assertEqual((OllamaProvider().host, OllamaProvider().port), (
                "ollama.example",
                11435,
            ))


if __name__ == "__main__":
    unittest.main()

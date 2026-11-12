"""
Unit tests covering the upgraded router/ package, in-memory fallback, and token configurations.
"""

from __future__ import annotations

import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import core.database as database_module
from core.database import DatabaseRouter, InMemoryDatabasePool
from core.model import ModelManager
from core.session import SessionStore
from router.api_manager import ApiManager, WebSocketManager
from router.broker import Event, EventBroker
from router.dispatcher import (
    DynamicDispatcher,
    TaskComplexity,
    analyze_task_complexity,
    should_enable_thinking,
)
from router.health import HealthMonitor, ServiceStatus
from router.router import InferenceRequest, InferenceResponse, Message, Router
from router.security import SecurityManager, is_private_or_local_ip


class RouterBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_publish_and_subscribe(self) -> None:
        broker = EventBroker()
        received: list[Event] = []

        broker.subscribe("inference.*", lambda e: received.append(e))

        await broker.publish("inference.started", {"model": "llama3"})
        await broker.publish("health.checked", {"status": "ok"})
        await broker.publish("inference.completed", {"tokens": 100})

        self.assertEqual(len(received), 2)
        self.assertEqual(received[0].topic, "inference.started")
        self.assertEqual(received[1].topic, "inference.completed")

    async def test_queue_and_wait_for(self) -> None:
        broker = EventBroker()
        sub_id, queue = broker.create_queue("agent.*")

        await broker.publish("agent.queued", {"id": "123"})
        event = await queue.get()
        self.assertEqual(event.topic, "agent.queued")
        self.assertEqual(event.data["id"], "123")

        # Test wait_for
        async def _publish_later() -> None:
            await asyncio.sleep(0.05)
            await broker.publish("system.ready", {"v": 1})

        asyncio.create_task(_publish_later())
        ready_event = await broker.wait_for("system.ready", timeout=1.0)
        self.assertEqual(ready_event.topic, "system.ready")
        self.assertEqual(ready_event.data["v"], 1)
        broker.unsubscribe(sub_id)


class RouterSecurityTests(unittest.TestCase):
    def test_ip_verification(self) -> None:
        self.assertTrue(is_private_or_local_ip("127.0.0.1"))
        self.assertTrue(is_private_or_local_ip("localhost"))
        self.assertTrue(is_private_or_local_ip("192.168.1.100"))
        self.assertTrue(is_private_or_local_ip("10.0.0.5"))
        self.assertTrue(is_private_or_local_ip("172.16.5.1"))
        self.assertTrue(is_private_or_local_ip("::1"))

        self.assertFalse(is_private_or_local_ip("8.8.8.8"))
        self.assertFalse(is_private_or_local_ip("1.1.1.1"))
        self.assertFalse(is_private_or_local_ip("not-an-ip"))

    def test_token_encryption_and_decryption(self) -> None:
        mgr = SecurityManager(secret_key="my-super-secret-key-12345")
        raw = "secret_ollama_token_value_xyz"
        encrypted = mgr.encrypt_token(raw)

        self.assertTrue(encrypted.startswith("enc."))
        decrypted = mgr.decrypt_token(encrypted)
        self.assertEqual(decrypted, raw)

        # Corrupted token should fail
        corrupted = encrypted[:-4] + "AAAA"
        with self.assertRaises(ValueError):
            mgr.decrypt_token(corrupted)

    def test_lan_request_authorization(self) -> None:
        mgr = SecurityManager(require_lan_auth=True, api_token="secret_token_123")

        # LAN IP without token -> forbidden
        ok, _ = mgr.verify_lan_request("192.168.1.50")
        self.assertFalse(ok)

        # LAN IP with valid token -> authorized
        ok, _ = mgr.verify_lan_request("192.168.1.50", auth_header="Bearer secret_token_123")
        self.assertTrue(ok)

        # Public IP -> forbidden regardless of token
        ok, _ = mgr.verify_lan_request("8.8.8.8", auth_header="Bearer secret_token_123")
        self.assertFalse(ok)


class RouterDispatcherTests(unittest.IsolatedAsyncioTestCase):
    def test_task_complexity_analysis(self) -> None:
        simple_msgs = [Message(role="user", content="Hello, how are you?")]
        simple = analyze_task_complexity(simple_msgs)
        self.assertEqual(simple.level, "simple")
        self.assertFalse(simple.has_code)

        complex_msgs = [
            Message(role="user", content="```python\ndef solve(x):\n    return x*2\n```\nExplain step-by-step why this works and optimize the architecture.")
        ]
        comp = analyze_task_complexity(complex_msgs)
        self.assertEqual(comp.level, "complex")
        self.assertTrue(comp.has_code)
        self.assertTrue(comp.reasoning_heavy)
        self.assertFalse(should_enable_thinking(simple))
        self.assertTrue(should_enable_thinking(comp))
        moderate = analyze_task_complexity([
            Message(role="user", content="Compare these approaches and evaluate the trade-offs."),
        ])
        self.assertEqual(moderate.level, "moderate")
        self.assertTrue(should_enable_thinking(moderate))

    async def test_dynamic_failover_execution(self) -> None:
        broker = EventBroker()
        fake_manager = SimpleNamespace()
        dispatcher = DynamicDispatcher(fake_manager, broker=broker)  # type: ignore[arg-type]

        decision = SimpleNamespace(
            provider_name="primary_failing",
            model_name="test_model",
            complexity=TaskComplexity("simple", 10, False, False),
            strategy="fast_path",
            fallback_providers=["secondary_healthy"],
        )

        call_log: list[str] = []

        async def _call(prov: str, model: str | None) -> str:
            call_log.append(prov)
            if prov == "primary_failing":
                raise ConnectionError("Primary provider connection refused")
            return "Success from secondary"

        res, winning_provider = await dispatcher.execute_with_failover(decision, _call)  # type: ignore[arg-type]
        self.assertEqual(res, "Success from secondary")
        self.assertEqual(winning_provider, "secondary_healthy")
        self.assertEqual(call_log, ["primary_failing", "secondary_healthy"])

        history = broker.history("routing.failover")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].data["from_provider"], "primary_failing")
        self.assertEqual(history[0].data["to_provider"], "secondary_healthy")

    async def test_strict_model_requests_do_not_use_search_or_fail_over(self) -> None:
        class FakeModelManager:
            async def available_providers(self) -> list[str]:
                return ["ollama", "lmstudio"]

            async def resolve(self, request: InferenceRequest) -> SimpleNamespace:
                return SimpleNamespace(
                    provider_name=request.provider_name,
                    model_name=request.model,
                    provider=request.provider_name,
                    messages=request.messages,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens,
                    api_token=None,
                    context_length=4096,
                    search_results=[],
                )

        router = Router(model_manager=FakeModelManager())  # type: ignore[arg-type]
        router._get_client = AsyncMock(return_value=object())  # type: ignore[method-assign]
        router._call_backend = AsyncMock(return_value={"content": "title"})  # type: ignore[method-assign]
        router._record_response = AsyncMock()  # type: ignore[method-assign]
        router._plan_search = AsyncMock(  # type: ignore[method-assign]
            side_effect=AssertionError("Strict title requests must not invoke search planning."),
        )
        router._parse_response = lambda _raw, provider, model: InferenceResponse(  # type: ignore[method-assign]
            content="title",
            provider=provider,
            model=model,
        )

        result = await router.route(InferenceRequest(
            messages=[Message(role="user", content="Summarize this conversation.")],
            provider_name="ollama",
            model="title-model",
            platform="webui",
            temperature=0.1,
            max_tokens=48,
            extra={
                "strict_model": True,
                "think": False,
                "disable_backend_timeout": True,
            },
        ))

        self.assertEqual(result.provider, "ollama")
        self.assertEqual(result.model, "title-model")
        self.assertEqual(router._call_backend.await_count, 1)
        self.assertEqual(router._call_backend.await_args.kwargs["model_id"], "title-model")
        self.assertTrue(router._call_backend.await_args.kwargs["disable_timeout"])
        self.assertEqual(router._call_backend.await_args.kwargs["extra"], {"think": False})


class DatabaseInMemoryFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_model_configuration_is_imported_once(self) -> None:
        pool = AsyncMock()
        database = DatabaseRouter(allow_fallback=False)
        fake_asyncpg = SimpleNamespace(
            create_pool=AsyncMock(return_value=pool),
        )
        with (
            patch.object(database_module, "asyncpg", fake_asyncpg),
            patch.dict(os.environ, {
                "DB_PASSWORD": "test-db-password",
                "ZEUS_PROVIDER": "ollama",
                "ZEUS_MODEL": "llama-test",
                "OLLAMA_API_KEY": "test-ollama-key",
            }, clear=True),
        ):
            await database.initialize()
            self.assertNotIn("ZEUS_PROVIDER", os.environ)
            self.assertNotIn("ZEUS_MODEL", os.environ)
            self.assertNotIn("OLLAMA_API_KEY", os.environ)

        migration_call = pool.execute.await_args_list[1]
        self.assertEqual(
            migration_call.args[1:],
            ("ollama", "llama-test", "test-ollama-key"),
        )
        await database.close()

    async def test_in_memory_fallback_sessions_and_messages(self) -> None:
        db = DatabaseRouter(allow_fallback=True)
        # Force fallback mode
        db.enable_fallback()
        self.assertTrue(db.is_fallback)

        store = SessionStore(db)
        session = await store.get_or_create(
            platform="webui",
            conversation_id="conv-123",
            user_id="user-456",
            metadata={"theme": "dark"},
        )
        self.assertEqual(session.conversation_id, "conv-123")
        self.assertEqual(session.platform, "webui")
        self.assertEqual(session.status, "active")

        # Append messages
        appended = await store.append_message({
            "platform": "webui",
            "conversation_id": "conv-123",
            "message_id": "msg-1",
            "role": "user",
            "content": "Hello in-memory fallback!",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        })
        self.assertTrue(appended)

        msgs = await store.get_messages("webui", "conv-123")
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]["content"], "Hello in-memory fallback!")

        # Usage
        usage = await store.usage("webui", "conv-123")
        self.assertEqual(usage["prompt_tokens"], 10)
        self.assertEqual(usage["completion_tokens"], 5)


class RouterHealthTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_monitor_triggers_db_fallback(self) -> None:
        db = DatabaseRouter(allow_fallback=True)
        broker = EventBroker()

        monitor = HealthMonitor(database=db, broker=broker)
        # Check database when postgres is not reachable -> should switch to fallback
        status = await monitor.check_database()
        self.assertEqual(status.status, "degraded")
        self.assertTrue(db.is_fallback)

        all_health = await monitor.check_all()
        self.assertIn("overall_status", all_health)
        self.assertIn(all_health["overall_status"], {"degraded", "unhealthy"})


class RouterApiManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_api_manager_health_and_security(self) -> None:
        broker = EventBroker()
        router = SimpleNamespace(
            available_models=AsyncMock(return_value=[{"model": "test-model"}]),
            available_providers=AsyncMock(return_value=["ollama"]),
        )
        health_mon = SimpleNamespace(
            check_all=AsyncMock(return_value={"overall_status": "healthy", "services": {}})
        )
        sec_mgr = SecurityManager(require_lan_auth=False)

        api = ApiManager(
            router=router,
            broker=broker,
            health_monitor=health_mon,  # type: ignore[arg-type]
            security_manager=sec_mgr,
        )

        code, data = await api.handle_health("127.0.0.1")
        self.assertEqual(code, 200)
        self.assertEqual(data["overall_status"], "healthy")

        code, data = await api.handle_models()
        self.assertEqual(code, 200)
        self.assertEqual(data["providers"], ["ollama"])


if __name__ == "__main__":
    unittest.main()

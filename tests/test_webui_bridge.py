from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from src import webui_bridge


async def call_asgi(
    app: webui_bridge.WebUiBridge,
    method: str,
    path: str,
    *,
    body: dict[str, object] | None = None,
) -> list[dict[str, object]]:
    body_bytes = json.dumps(body or {}).encode()
    requests = [{"type": "http.request", "body": body_bytes, "more_body": False}]

    async def receive() -> dict[str, object]:
        if requests:
            return requests.pop(0)
        return {"type": "http.disconnect"}

    responses: list[dict[str, object]] = []

    async def send(event: dict[str, object]) -> None:
        responses.append(event)

    await app(
        {"type": "http", "method": method, "path": path},
        receive,
        send,
    )
    return responses


def response_json(events: list[dict[str, object]]) -> dict[str, object]:
    body = next(event["body"] for event in events if event["type"] == "http.response.body")
    return json.loads(body)


class WebUiBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_browser_loop_is_started_and_stopped_with_webui_lifespan(self) -> None:
        class Loop:
            started = False
            stopped = False

            async def start(self) -> None:
                self.started = True

            async def shutdown(self) -> None:
                self.stopped = True

        loop = Loop()
        receive_events = iter([
            {"type": "lifespan.startup"},
            {"type": "lifespan.shutdown"},
        ])
        sent: list[dict[str, object]] = []

        async def receive() -> dict[str, object]:
            return next(receive_events)

        async def send(event: dict[str, object]) -> None:
            sent.append(event)

        with (
            patch.object(webui_bridge, "_database") as database,
            patch.object(webui_bridge, "_memory_store") as memory,
            patch.object(webui_bridge, "_session_manager") as sessions,
        ):
            database.initialize = AsyncMock()
            database.close = AsyncMock()
            memory.start = AsyncMock()
            memory.stop = AsyncMock()
            sessions.shutdown = AsyncMock()
            await webui_bridge.create_app(browser_loop=loop)(
                {"type": "lifespan"},
                receive,
                send,
            )

        self.assertTrue(loop.started)
        self.assertTrue(loop.stopped)
        self.assertEqual(
            [event["type"] for event in sent],
            ["lifespan.startup.complete", "lifespan.shutdown.complete"],
        )

    async def test_health_endpoint_is_independent_of_platform_bridge(self) -> None:
        response = await call_asgi(webui_bridge.create_app(), "GET", "/health")
        self.assertEqual(response[0]["status"], 200)
        self.assertEqual(response_json(response), {"status": "ok"})

    async def test_about_endpoint_reports_python_runtime_and_required_dependencies(self) -> None:
        response = await call_asgi(webui_bridge.create_app(), "GET", "/about")
        self.assertEqual(response[0]["status"], 200)
        self.assertEqual(
            response_json(response),
            {
                "python_version": ".".join(
                    str(part) for part in webui_bridge.sys.version_info[:3]
                ),
                "dependencies": webui_bridge._required_python_dependencies(),
            },
        )

    async def test_infer_rejects_empty_messages(self) -> None:
        response = await call_asgi(
            webui_bridge.create_app(),
            "POST",
            "/infer",
            body={"messages": []},
        )
        self.assertEqual(response[0]["status"], 400)
        self.assertIn("non-empty list", response_json(response)["error"])

    async def test_infer_routes_webui_session_through_shared_router(self) -> None:
        class FakeSessions:
            async def open_session(self, **kwargs: object) -> object:
                self.kwargs = kwargs
                return "session"

        class FakeRouter:
            async def route(self, request: object) -> object:
                self.request = request
                return type("Result", (), {
                    "content": "answer",
                    "thinking": "",
                    "model": "local-model",
                    "provider": "ollama",
                    "prompt_tokens": 4,
                    "completion_tokens": 2,
                    "context_length": 8192,
                    "finish_reason": "stop",
                })()

        sessions = FakeSessions()
        router = FakeRouter()
        with (
            patch.object(webui_bridge, "_session_manager", sessions),
            patch.object(webui_bridge, "_router", router),
        ):
            response = await call_asgi(
                webui_bridge.create_app(),
                "POST",
                "/infer",
                body={
                    "platform": "webui",
                    "provider": "ollama",
                    "model": "local-model",
                    "session": {
                        "conversation_id": "conversation-1",
                        "user_id": "webui-conversation-1",
                    },
                    "tools": ["search"],
                    "messages": [{"role": "user", "content": "hello"}],
                },
            )

        self.assertEqual(response[0]["status"], 200)
        self.assertEqual(response_json(response)["content"], "answer")
        self.assertEqual(response_json(response)["context_length"], 8192)
        self.assertEqual(sessions.kwargs["platform"], "webui")
        self.assertEqual(router.request.session, "session")
        self.assertEqual(router.request.platform, "webui")
        self.assertEqual(router.request.messages[0].content, "hello")
        self.assertEqual(router.request.extra["tools"], ["search"])

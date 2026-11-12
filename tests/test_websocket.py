from __future__ import annotations

import asyncio
import json
import unittest

from src.websocket import CentralBridgeApplication, WebSocketManager


class WebSocketManagerTests(unittest.IsolatedAsyncioTestCase):
    async def exchange(
        self,
        handler,
        frame: dict[str, object],
        *,
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> list[dict[str, object]]:
        incoming: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        outgoing: asyncio.Queue[dict[str, object]] = asyncio.Queue()

        async def receive() -> dict[str, object]:
            return await incoming.get()

        async def send(message: dict[str, object]) -> None:
            await outgoing.put(message)

        scope: dict[str, object] = {
            "type": "websocket",
            "path": "/ws",
            "scheme": "ws",
            "headers": headers or [],
        }
        task = asyncio.create_task(
            WebSocketManager().handle(scope, receive, send, handler),
        )
        await incoming.put({"type": "websocket.connect"})
        self.assertEqual((await outgoing.get())["type"], "websocket.accept")
        await incoming.put({
            "type": "websocket.receive",
            "text": json.dumps(frame),
        })

        responses: list[dict[str, object]] = []
        while True:
            message = await asyncio.wait_for(outgoing.get(), timeout=1)
            responses.append(message)
            if message.get("text"):
                response = json.loads(message["text"])
                if response.get("type") in {"response", "stream_end"}:
                    break

        await incoming.put({"type": "websocket.disconnect"})
        await task
        return responses

    async def test_dispatches_rpc_to_http_handler_with_query_body_and_auth(self) -> None:
        async def handler(scope, receive, send):
            request = await receive()
            payload = json.loads(request["body"])
            body = json.dumps({
                "path": scope["path"],
                "query": scope["query_string"].decode(),
                "authorization": dict(scope["headers"])[b"authorization"].decode(),
                "payload": payload,
            }).encode()
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": body})

        events = await self.exchange(
            handler,
            {
                "id": "request-1",
                "method": "POST",
                "path": "/agent/run?platform=discord",
                "body": {"prompt": "hello"},
            },
            headers=[(b"authorization", b"Bearer test-token")],
        )
        response = json.loads(events[-1]["text"])
        self.assertEqual(response["id"], "request-1")
        self.assertEqual(response["type"], "response")
        self.assertEqual(response["status"], 200)
        self.assertEqual(json.loads(response["body"]), {
            "path": "/agent/run",
            "query": "platform=discord",
            "authorization": "Bearer test-token",
            "payload": {"prompt": "hello"},
        })

    async def test_forwards_sse_chunks_as_stream_frames(self) -> None:
        async def handler(_scope, _receive, send):
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/event-stream")],
            })
            await send({
                "type": "http.response.body",
                "body": b"event: delta\ndata: {\"text\":\"hi\"}\n\n",
                "more_body": True,
            })
            await send({
                "type": "http.response.body",
                "body": b"",
                "more_body": False,
            })

        events = await self.exchange(
            handler,
            {"id": "stream-1", "method": "POST", "path": "/infer", "body": {}},
        )
        frames = [json.loads(event["text"]) for event in events if event.get("text")]
        self.assertEqual([frame["type"] for frame in frames], [
            "stream_start", "stream_chunk", "stream_end",
        ])
        self.assertEqual(frames[1]["body"], 'event: delta\ndata: {"text":"hi"}\n\n')

    async def test_cancellation_stops_inflight_handler(self) -> None:
        incoming: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        outgoing: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def receive() -> dict[str, object]:
            return await incoming.get()

        async def send(message: dict[str, object]) -> None:
            await outgoing.put(message)

        async def handler(_scope, _receive, _send):
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        task = asyncio.create_task(WebSocketManager().handle(
            {"type": "websocket", "path": "/ws", "headers": []},
            receive,
            send,
            handler,
        ))
        await incoming.put({"type": "websocket.connect"})
        await outgoing.get()
        await incoming.put({
            "type": "websocket.receive",
            "text": json.dumps({"id": "slow", "method": "POST", "path": "/infer"}),
        })
        await asyncio.wait_for(started.wait(), timeout=1)
        await incoming.put({
            "type": "websocket.receive",
            "text": json.dumps({"type": "cancel", "id": "slow"}),
        })
        await asyncio.wait_for(cancelled.wait(), timeout=1)
        await incoming.put({"type": "websocket.disconnect"})
        await task

    async def test_central_server_routes_to_the_requested_bridge(self) -> None:
        class FakeBridge:
            def __init__(self, service: str) -> None:
                self.service = service

            async def _http(self, _scope, _receive, send):
                body = json.dumps({"service": self.service}).encode()
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": body})

        app = CentralBridgeApplication(
            FakeBridge("platform"),
            FakeBridge("webui"),
            platform_token="test-token",
        )
        events = await self.exchange(
            app._dispatch_http,
            {
                "id": "webui-request",
                "service": "webui",
                "method": "GET",
                "path": "/models",
            },
            headers=[(b"authorization", b"Bearer test-token")],
        )
        response = json.loads(events[-1]["text"])
        self.assertEqual(json.loads(response["body"]), {"service": "webui"})

    async def test_central_webui_rpc_requires_platform_token_when_shared(self) -> None:
        class FakeBridge:
            async def _http(self, _scope, _receive, _send):
                raise AssertionError("Unauthorized RPC must not reach the handler.")

        app = CentralBridgeApplication(
            FakeBridge(),
            FakeBridge(),
            platform_token="test-token",
        )
        events = await self.exchange(
            app._dispatch_http,
            {
                "id": "unauthorized-webui",
                "service": "webui",
                "method": "GET",
                "path": "/models",
            },
        )
        response = json.loads(events[-1]["text"])
        self.assertEqual(response["status"], 401)
        self.assertEqual(json.loads(response["body"]), {"error": "Unauthorized."})

    async def test_central_server_starts_and_stops_child_lifespans(self) -> None:
        class FakeBridge:
            def __init__(self) -> None:
                self.started = False
                self.stopped = False

            async def __call__(self, _scope, receive, send):
                while True:
                    event = await receive()
                    if event["type"] == "lifespan.startup":
                        self.started = True
                        await send({"type": "lifespan.startup.complete"})
                    elif event["type"] == "lifespan.shutdown":
                        self.stopped = True
                        await send({"type": "lifespan.shutdown.complete"})
                        return

        platform = FakeBridge()
        webui = FakeBridge()
        app = CentralBridgeApplication(platform, webui)
        incoming: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        outgoing: asyncio.Queue[dict[str, object]] = asyncio.Queue()

        async def receive():
            return await incoming.get()

        async def send(message):
            await outgoing.put(message)

        task = asyncio.create_task(app(
            {"type": "lifespan"},
            receive,
            send,
        ))
        await incoming.put({"type": "lifespan.startup"})
        self.assertEqual(
            (await asyncio.wait_for(outgoing.get(), timeout=1))["type"],
            "lifespan.startup.complete",
        )
        self.assertTrue(platform.started)
        self.assertTrue(webui.started)
        await incoming.put({"type": "lifespan.shutdown"})
        self.assertEqual(
            (await asyncio.wait_for(outgoing.get(), timeout=1))["type"],
            "lifespan.shutdown.complete",
        )
        await task
        self.assertTrue(platform.stopped)
        self.assertTrue(webui.stopped)


if __name__ == "__main__":
    unittest.main()

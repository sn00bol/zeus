"""
router/api_manager — RESTful API and WebSocket communication manager.

Coordinates HTTP endpoints and real-time WebSockets for WebUI, Discord bot,
and LAN platform clients with integrated security and event broadcasting.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable
from uuid import uuid4

from router.broker import Event, EventBroker, get_event_broker
from router.health import HealthMonitor, get_health_monitor
from router.security import SecurityManager, get_security_manager

log = logging.getLogger(__name__)


class WebSocketManager:
    """Manages active WebSocket connections from WebUI and Discord bot."""

    def __init__(self, broker: EventBroker) -> None:
        self.broker = broker
        self._connections: dict[str, Any] = {}
        self._lock = asyncio.Lock()

        # Automatically broadcast broker events to active WebSockets
        self.broker.subscribe("*", self._on_broker_event)

    async def connect(self, client_id: str, websocket: Any) -> None:
        async with self._lock:
            self._connections[client_id] = websocket
        log.info("WebSocket connected: %s (total: %d)", client_id, len(self._connections))

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            self._connections.pop(client_id, None)
        log.info("WebSocket disconnected: %s", client_id)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast JSON message to all connected clients."""
        async with self._lock:
            targets = list(self._connections.items())

        raw = json.dumps(message, ensure_ascii=False)
        for client_id, ws in targets:
            try:
                # Support standard ASGI websocket send or custom websocket objects
                if hasattr(ws, "send_text"):
                    await ws.send_text(raw)
                elif callable(ws):
                    await ws({"type": "websocket.send", "text": raw})
            except Exception:
                log.warning("Failed to send WebSocket message to client %s", client_id)
                await self.disconnect(client_id)

    async def _on_broker_event(self, event: Event) -> None:
        payload = {
            "type": "event",
            "topic": event.topic,
            "data": event.data,
            "event_id": event.event_id,
            "timestamp": event.timestamp,
        }
        await self.broadcast(payload)


class ApiManager:
    """
    Unified manager handling REST and WebSocket communications.
    """

    def __init__(
        self,
        router: Any,  # Router instance
        broker: EventBroker | None = None,
        health_monitor: HealthMonitor | None = None,
        security_manager: SecurityManager | None = None,
        agent_runner: Any | None = None,
    ) -> None:
        self.router = router
        self.broker = broker or get_event_broker()
        self.health_monitor = health_monitor or get_health_monitor()
        self.security_manager = security_manager or get_security_manager()
        self.agent_runner = agent_runner
        self.ws_manager = WebSocketManager(self.broker)

    # ------------------------------------------------------------------
    # REST API Handlers
    # ------------------------------------------------------------------

    async def handle_health(self, client_ip: str = "127.0.0.1") -> tuple[int, dict[str, Any]]:
        """Return comprehensive system health status."""
        health = await self.health_monitor.check_all()
        status_code = 200 if health.get("overall_status") in {"healthy", "degraded"} else 503
        return status_code, health

    async def handle_models(self) -> tuple[int, dict[str, Any]]:
        """Return available models and reachable providers."""
        models = await self.router.available_models()
        providers = await self.router.available_providers()
        return 200, {"models": models, "providers": providers}

    async def handle_infer(
        self,
        body: dict[str, Any],
        client_ip: str = "127.0.0.1",
        auth_header: str | None = None,
    ) -> tuple[int, dict[str, Any]]:
        """
        Validate, authenticate, and route an inference request.
        """
        # 1. LAN security check
        authorized, reason = self.security_manager.verify_lan_request(
            client_ip, auth_header, action="infer"
        )
        if not authorized:
            return 403, {"error": reason}

        # 2. Parse request
        raw_messages = body.get("messages")
        if not isinstance(raw_messages, list) or not raw_messages:
            return 400, {"error": "'messages' must be a non-empty list."}

        from router.router import InferenceRequest, Message
        messages = [
            Message(role=str(m.get("role", "user")), content=str(m.get("content", "")))
            for m in raw_messages if isinstance(m, dict)
        ]

        platform = str(body.get("platform") or "webui")
        request = InferenceRequest(
            messages=messages,
            model=body.get("model") or None,
            provider_name=body.get("provider") or None,
            stream=bool(body.get("stream", False)),
            temperature=body.get("temperature"),
            max_tokens=body.get("max_tokens"),
            platform=platform,
            extra={
                k: v for k, v in body.items()
                if k not in {"messages", "model", "provider", "stream", "temperature", "max_tokens", "platform"}
            },
        )

        try:
            res = await self.router.route(request)
            return 200, {
                "content": res.content,
                "model": res.model,
                "provider": res.provider,
                "prompt_tokens": res.prompt_tokens,
                "completion_tokens": res.completion_tokens,
                "finish_reason": res.finish_reason,
            }
        except Exception as exc:
            log.exception("Inference processing error")
            return 500, {"error": str(exc)}

    async def handle_security_verify(
        self,
        client_ip: str,
        auth_header: str | None = None,
    ) -> tuple[int, dict[str, Any]]:
        """Verify LAN client access credentials."""
        authorized, reason = self.security_manager.verify_lan_request(client_ip, auth_header)
        status_code = 200 if authorized else 403
        return status_code, {
            "authorized": authorized,
            "client_ip": client_ip,
            "reason": reason,
        }

    # ------------------------------------------------------------------
    # ASGI Application Interface
    # ------------------------------------------------------------------

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        """ASGI 3.0 handler for HTTP and WebSocket requests."""
        scope_type = scope.get("type")
        if scope_type == "lifespan":
            while True:
                event = await receive()
                if event["type"] == "lifespan.startup":
                    await self.health_monitor.start()
                    await send({"type": "lifespan.startup.complete"})
                elif event["type"] == "lifespan.shutdown":
                    await self.health_monitor.stop()
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        elif scope_type == "http":
            await self._handle_http(scope, receive, send)
        elif scope_type == "websocket":
            await self._handle_websocket(scope, receive, send)

    async def _handle_http(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        method = scope["method"]
        path = scope["path"]
        client = scope.get("client")
        client_ip = client[0] if client else "127.0.0.1"

        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("utf-8") or None

        if method == "GET" and path == "/health":
            code, data = await self.handle_health(client_ip)
            await self._send_json(send, data, code)
            return

        if method == "GET" and path == "/models":
            code, data = await self.handle_models()
            await self._send_json(send, data, code)
            return

        if method == "POST" and path == "/security/verify":
            code, data = await self.handle_security_verify(client_ip, auth_header)
            await self._send_json(send, data, code)
            return

        if method == "POST" and path == "/infer":
            chunks: list[bytes] = []
            while True:
                msg = await receive()
                chunks.append(msg.get("body", b""))
                if not msg.get("more_body", False):
                    break
            try:
                body = json.loads(b"".join(chunks).decode("utf-8"))
            except Exception:
                await self._send_json(send, {"error": "Invalid JSON"}, 400)
                return

            code, data = await self.handle_infer(body, client_ip, auth_header)
            await self._send_json(send, data, code)
            return

        await self._send_json(send, {"error": "Not Found"}, 404)

    async def _handle_websocket(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        client_id = uuid4().hex
        await send({"type": "websocket.accept"})
        await self.ws_manager.connect(client_id, send)

        try:
            while True:
                msg = await receive()
                if msg["type"] == "websocket.disconnect":
                    break
                text = msg.get("text")
                if text:
                    try:
                        req = json.loads(text)
                        if req.get("action") == "ping":
                            await send({"type": "websocket.send", "text": json.dumps({"action": "pong"})})
                    except Exception:
                        pass
        finally:
            await self.ws_manager.disconnect(client_id)

    @staticmethod
    async def _send_json(send: Any, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})

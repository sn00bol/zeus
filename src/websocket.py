from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

from src.bridge_security import is_authenticated

try:
    import uvicorn
except ImportError:
    uvicorn = None  # type: ignore[assignment]

log = logging.getLogger(__name__)
HttpHandler = Callable[[dict[str, Any], Any, Any], Awaitable[None]]
MAX_WEBSOCKET_MESSAGE_BYTES = 128 * 1024 * 1024
if os.environ.get("ZEUS_BRIDGE_PLATFORM"):
    _BRIDGE_HOST = os.environ.get("BRIDGE_HOST", "127.0.0.1")
else:
    _BRIDGE_HOST = (
        os.environ.get("WEBUI_BRIDGE_HOST")
        or os.environ.get("BRIDGE_HOST")
        or "127.0.0.1"
    )
_BRIDGE_PORT = int(
    os.environ.get("BRIDGE_PORT") or os.environ.get("WEBUI_BRIDGE_PORT", "5002"),
)


class WebSocketManager:
    async def handle(
        self,
        scope: dict[str, Any],
        receive: Any,
        send: Any,
        http_handler: HttpHandler,
    ) -> None:
        if scope.get("path") != "/ws":
            await send({"type": "websocket.close", "code": 1008})
            return

        event = await receive()
        if event["type"] != "websocket.connect":
            return
        await send({"type": "websocket.accept"})

        send_lock = asyncio.Lock()
        requests: dict[str, asyncio.Task[None]] = {}

        async def send_frame(frame: dict[str, Any]) -> None:
            async with send_lock:
                await send({
                    "type": "websocket.send",
                    "text": json.dumps(frame, ensure_ascii=False),
                })

        async def dispatch(frame: dict[str, Any]) -> None:
            request_id = frame.get("id")
            try:
                if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
                    raise ValueError("A valid request id is required.")
                method = frame.get("method")
                if not isinstance(method, str) or method.upper() not in {
                    "GET", "POST", "PUT", "PATCH", "DELETE",
                }:
                    raise ValueError("A supported HTTP method is required.")
                path = frame.get("path")
                if not isinstance(path, str):
                    raise TypeError("A request path is required.")
                service = frame.get("service", "platform")
                if service not in {"platform", "webui"}:
                    raise ValueError("A supported bridge service is required.")
                parsed_path = urlsplit(path)
                if parsed_path.scheme or parsed_path.netloc or not parsed_path.path.startswith("/"):
                    raise ValueError("The request path must be relative to the bridge.")

                if "body" not in frame:
                    raw_body = b""
                else:
                    raw_body = json.dumps(frame["body"], ensure_ascii=False).encode("utf-8")
                request_headers = [
                    (key.lower(), value)
                    for key, value in scope.get("headers", [])
                    if key.lower() == b"authorization"
                ]
                if raw_body:
                    request_headers.append((b"content-type", b"application/json"))

                request_scope = {
                    **scope,
                    "type": "http",
                    "method": method.upper(),
                    "path": parsed_path.path,
                    "query_string": parsed_path.query.encode("ascii"),
                    "headers": request_headers,
                    "scheme": "https" if scope.get("scheme") == "wss" else "http",
                    "raw_path": parsed_path.path.encode("utf-8"),
                    "http_version": "1.1",
                    "bridge_service": service,
                }
                body_sent = False

                async def request_receive() -> dict[str, Any]:
                    nonlocal body_sent
                    if body_sent:
                        await asyncio.Future()
                    body_sent = True
                    return {
                        "type": "http.request",
                        "body": raw_body,
                        "more_body": False,
                    }

                status = 200
                body_chunks: list[bytes] = []
                streaming = False
                response_started = False

                async def response_send(message: dict[str, Any]) -> None:
                    nonlocal status, streaming, response_started
                    if message["type"] == "http.response.start":
                        status = message["status"]
                        streaming = any(
                            key.lower() == b"content-type"
                            and value.lower().startswith(b"text/event-stream")
                            for key, value in message.get("headers", [])
                        )
                        response_started = True
                        if streaming:
                            await send_frame({
                                "id": request_id,
                                "type": "stream_start",
                                "status": status,
                            })
                    elif message["type"] == "http.response.body":
                        chunk = message.get("body", b"")
                        if streaming:
                            if chunk:
                                await send_frame({
                                    "id": request_id,
                                    "type": "stream_chunk",
                                    "body": chunk.decode("utf-8", errors="replace"),
                                })
                            if not message.get("more_body", False):
                                await send_frame({"id": request_id, "type": "stream_end"})
                        else:
                            body_chunks.append(chunk)
                            if not message.get("more_body", False):
                                await send_frame({
                                    "id": request_id,
                                    "type": "response",
                                    "status": status,
                                    "body": b"".join(body_chunks).decode("utf-8", errors="replace"),
                                })

                await http_handler(request_scope, request_receive, response_send)
                if not response_started:
                    raise RuntimeError("The bridge handler did not start an HTTP response.")
            except asyncio.CancelledError:
                raise
            except (TypeError, ValueError) as exc:
                if isinstance(request_id, str) and request_id:
                    await send_frame({
                        "id": request_id,
                        "type": "response",
                        "status": 400,
                        "body": json.dumps({"error": str(exc)}),
                    })
            except Exception:
                log.exception("WebSocket bridge request failed.")
                if isinstance(request_id, str) and request_id:
                    await send_frame({
                        "id": request_id,
                        "type": "response",
                        "status": 500,
                        "body": json.dumps({"error": "Internal bridge error."}),
                    })
            finally:
                if isinstance(request_id, str):
                    requests.pop(request_id, None)

        try:
            while True:
                message = await receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message["type"] != "websocket.receive":
                    continue
                try:
                    raw_message = message.get("text")
                    if raw_message is None:
                        raw_message = (message.get("bytes") or b"").decode("utf-8")
                    frame = json.loads(raw_message)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    await send_frame({
                        "type": "error",
                        "error": "The WebSocket message must be valid JSON.",
                    })
                    continue
                if not isinstance(frame, dict):
                    await send_frame({
                        "type": "error",
                        "error": "The WebSocket message must be an object.",
                    })
                    continue
                if frame.get("type") == "cancel":
                    request_id = frame.get("id")
                    task = requests.get(request_id) if isinstance(request_id, str) else None
                    if task is not None:
                        task.cancel()
                    continue
                request_id = frame.get("id")
                if isinstance(request_id, str) and request_id in requests:
                    await send_frame({
                        "id": request_id,
                        "type": "response",
                        "status": 409,
                        "body": json.dumps({"error": "Duplicate request id."}),
                    })
                    continue
                task = asyncio.create_task(dispatch(frame))
                if isinstance(request_id, str):
                    requests[request_id] = task
        finally:
            tasks = list(requests.values())
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)


websocket_manager = WebSocketManager()


async def _send_json(send: Any, data: dict[str, Any], status: int = 200) -> None:
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


class CentralBridgeApplication:
    def __init__(
        self,
        platform_app: Any,
        webui_app: Any,
        *,
        platform_token: str = "",
    ) -> None:
        self._platform_app = platform_app
        self._webui_app = webui_app
        self._platform_token = platform_token
        self._lifespans: list[tuple[asyncio.Task[None], asyncio.Queue[Any], asyncio.Queue[Any]]] = []

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(receive, send)
        elif scope["type"] == "http":
            await self._http(scope, receive, send)
        elif scope["type"] == "websocket":
            await websocket_manager.handle(scope, receive, send, self._dispatch_http)

    async def _start_child(self, app: Any) -> tuple[asyncio.Task[None], asyncio.Queue[Any], asyncio.Queue[Any]]:
        events: asyncio.Queue[Any] = asyncio.Queue()
        messages: asyncio.Queue[Any] = asyncio.Queue()

        async def child_receive() -> Any:
            return await events.get()

        async def child_send(message: Any) -> None:
            await messages.put(message)

        task = asyncio.create_task(app(
            {"type": "lifespan"},
            child_receive,
            child_send,
        ))
        await events.put({"type": "lifespan.startup"})
        response_task = asyncio.create_task(messages.get())
        done, _ = await asyncio.wait(
            (task, response_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if response_task not in done:
            response_task.cancel()
            await asyncio.gather(response_task, return_exceptions=True)
            task.result()
            raise RuntimeError("A bridge lifespan stopped before startup completed.")
        response = response_task.result()
        if response["type"] != "lifespan.startup.complete":
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise RuntimeError(response.get("message", "Bridge startup failed."))
        return task, events, messages

    async def _stop_children(self) -> None:
        failure: Exception | None = None
        for task, events, messages in reversed(self._lifespans):
            try:
                await events.put({"type": "lifespan.shutdown"})
                response_task = asyncio.create_task(messages.get())
                done, _ = await asyncio.wait(
                    (task, response_task),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if response_task not in done:
                    response_task.cancel()
                    await asyncio.gather(response_task, return_exceptions=True)
                    task.result()
                    raise RuntimeError("A bridge lifespan stopped before shutdown completed.")
                response = response_task.result()
                await task
                if response["type"] != "lifespan.shutdown.complete":
                    raise RuntimeError(response.get("message", "Bridge shutdown failed."))
            except Exception as exc:
                log.exception("A bridge failed to shut down cleanly.")
                if failure is None:
                    failure = exc
        self._lifespans.clear()
        if failure is not None:
            raise RuntimeError("One or more bridge apps failed to shut down.") from failure

    async def _lifespan(self, receive: Any, send: Any) -> None:
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup":
                try:
                    apps = [self._webui_app]
                    if self._platform_app is not None:
                        apps.insert(0, self._platform_app)
                    for app in apps:
                        self._lifespans.append(await self._start_child(app))
                except Exception as exc:
                    log.exception("Central bridge startup failed.")
                    try:
                        await self._stop_children()
                    except Exception:
                        log.exception("Bridge cleanup after startup failure failed.")
                    await send({
                        "type": "lifespan.startup.failed",
                        "message": str(exc),
                    })
                    return
                await send({"type": "lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                try:
                    await self._stop_children()
                except RuntimeError as exc:
                    await send({
                        "type": "lifespan.shutdown.failed",
                        "message": str(exc),
                    })
                else:
                    await send({"type": "lifespan.shutdown.complete"})
                return

    async def _dispatch_http(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        service = scope.get("bridge_service")
        if (
            service == "webui"
            and self._platform_app is not None
            and not is_authenticated(scope, self._platform_token)
        ):
            await _send_json(send, {"error": "Unauthorized."}, 401)
            return
        app = self._webui_app if service == "webui" else self._platform_app
        if app is None:
            await _send_json(send, {"error": "The requested bridge service is unavailable."}, 503)
            return
        await app._http(scope, receive, send)

    async def _http(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["method"] == "GET" and scope["path"] == "/health":
            await _send_json(send, {"status": "ok"})
            return
        if self._platform_app is not None:
            await self._platform_app._http(scope, receive, send)
            return
        await _send_json(send, {"error": "Not found."}, 404)


def create_app() -> CentralBridgeApplication:
    from src.webui_bridge import create_app as create_webui_app

    platform_app = None
    platform = os.environ.get("ZEUS_BRIDGE_PLATFORM", "").strip().lower()
    if platform:
        if platform not in {"discord", "telegram"}:
            raise ValueError("ZEUS_BRIDGE_PLATFORM must be discord or telegram.")
        if platform == "discord":
            from src.discord_bridge import create_app as create_platform_app
        else:
            from src.telegram_bridge import create_app as create_platform_app
        platform_app = create_platform_app()

    return CentralBridgeApplication(
        platform_app,
        create_webui_app(),
        platform_token=os.environ.get("BRIDGE_TOKEN", "").strip(),
    )


def main() -> None:
    if uvicorn is None:
        raise RuntimeError("uvicorn is required: install the project requirements")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [bridge] %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    uvicorn.run(
        create_app(),
        host=_BRIDGE_HOST,
        port=_BRIDGE_PORT,
        log_config=None,
        ws_max_size=MAX_WEBSOCKET_MESSAGE_BYTES,
    )


if __name__ == "__main__":
    main()
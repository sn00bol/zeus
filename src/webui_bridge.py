"""Private inference bridge owned by the Node WebUI server."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

try:
    import uvicorn
except ImportError:
    uvicorn = None  # type: ignore[assignment]

from dotenv import load_dotenv

load_dotenv()

from core.database import DatabaseRouter
from core.memory import MemoryStore
from core.session_manager import SessionManager
from router.router import InferenceRequest, Message, Router
from src.skills.personality import get_personality

log = logging.getLogger("webui_bridge")
_BRIDGE_HOST = os.environ.get("WEBUI_BRIDGE_HOST", "127.0.0.1")
_BRIDGE_PORT = int(os.environ.get("WEBUI_BRIDGE_PORT", "5002"))
_database = DatabaseRouter()
_session_manager = SessionManager(_database)
_memory_store = MemoryStore(_database)
_router = Router(memory_store=_memory_store, session_manager=_session_manager)


def _json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


async def _read_json(receive: Any) -> dict[str, Any]:
    chunks: list[bytes] = []
    size = 0
    while True:
        event = await receive()
        if event["type"] == "http.disconnect":
            raise ValueError("Request disconnected before its body was received.")
        chunk = event.get("body", b"")
        size += len(chunk)
        if size > 1_048_576:
            raise ValueError("Request body is too large.")
        chunks.append(chunk)
        if not event.get("more_body", False):
            break
    try:
        body = json.loads(b"".join(chunks))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid JSON body.") from exc
    if not isinstance(body, dict):
        raise ValueError("JSON body must be an object.")
    return body


async def _send_json(send: Any, data: Any, status: int = 200) -> None:
    body = _json_bytes(data)
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json; charset=utf-8"),
            (b"content-length", str(len(body)).encode("ascii")),
            (b"cache-control", b"no-store"),
        ],
    })
    await send({"type": "http.response.body", "body": body})


class WebUiBridge:
    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(receive, send)
        elif scope["type"] == "http":
            await self._http(scope, receive, send)

    async def _lifespan(self, receive: Any, send: Any) -> None:
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup":
                await _database.initialize()
                await _memory_store.start()
                await send({"type": "lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                await _session_manager.shutdown()
                await _memory_store.stop()
                await _database.close()
                await send({"type": "lifespan.shutdown.complete"})
                return

    async def _http(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        method = scope["method"]
        path = scope["path"]
        if method == "GET" and path == "/health":
            await _send_json(send, {"status": "ok"})
            return
        if method == "GET" and path == "/models":
            await _send_json(send, {"models": await _router.available_models()})
            return
        if method == "GET" and path == "/status":
            await _send_json(send, {"model": await _router.model_manager.status()})
            return
        if method != "POST" or path != "/infer":
            await _send_json(send, {"error": "Not found."}, status=404)
            return

        try:
            body = await _read_json(receive)
            raw_messages = body.get("messages")
            if not isinstance(raw_messages, list) or not raw_messages:
                raise ValueError("'messages' must be a non-empty list.")
            messages: list[Message] = []
            for item in raw_messages:
                if not isinstance(item, dict):
                    raise ValueError("Each message must be an object.")
                messages.append(Message(
                    role=str(item.get("role", "user")),
                    content=str(item.get("content", "")),
                ))

            platform = str(body.get("platform") or "webui")
            session_data = body.get("session")
            session = None
            if session_data is not None:
                if not isinstance(session_data, dict):
                    raise ValueError("'session' must be an object.")
                conversation_id = str(session_data.get("conversation_id") or "").strip()
                if not conversation_id:
                    raise ValueError("'session.conversation_id' is required.")
                metadata = session_data.get("metadata")
                if metadata is not None and not isinstance(metadata, dict):
                    raise ValueError("'session.metadata' must be an object.")
                session = await _session_manager.open_session(
                    platform=str(session_data.get("platform") or platform),
                    conversation_id=conversation_id,
                    user_id=(
                        str(session_data["user_id"])
                        if session_data.get("user_id") is not None else None
                    ),
                    metadata=metadata,
                )

            personality_name = body.get("personality")
            request = InferenceRequest(
                messages=messages,
                model=body.get("model") or None,
                provider_name=body.get("provider") or None,
                stream=bool(body.get("stream", False)),
                temperature=body.get("temperature"),
                max_tokens=body.get("max_tokens"),
                personality=get_personality(personality_name) if personality_name else None,
                platform=platform,
                extra={
                    key: value for key, value in body.items()
                    if key not in {
                        "messages", "model", "provider", "stream", "temperature",
                        "max_tokens", "personality", "platform", "session",
                    }
                },
                session=session,
            )
            result = await _router.route(request)
        except ValueError as exc:
            await _send_json(send, {"error": str(exc)}, status=400)
        except RuntimeError as exc:
            log.error("WebUI inference failed: %s", exc)
            await _send_json(send, {"error": str(exc)}, status=503)
        except Exception:
            log.exception("Unexpected error during WebUI inference.")
            await _send_json(send, {"error": "Internal inference error."}, status=500)
        else:
            await _send_json(send, {
                "content": result.content,
                "model": result.model,
                "provider": result.provider,
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "finish_reason": result.finish_reason,
            })


def create_app() -> WebUiBridge:
    return WebUiBridge()


def main() -> None:
    if uvicorn is None:
        raise RuntimeError("uvicorn is required: install the project requirements")
    uvicorn.run(create_app(), host=_BRIDGE_HOST, port=_BRIDGE_PORT, log_config=None)


if __name__ == "__main__":
    main()

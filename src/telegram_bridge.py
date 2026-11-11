"""
HTTP bridge between the Telegram bot (Node.js) and the Python inference router.

Run with ``python -m src.telegram_bridge``. The bridge exposes health,
provider discovery, synchronous inference, and queued background agent runs.
"""

from __future__ import annotations

import json
import logging
import os
import asyncio
import subprocess
from datetime import datetime, timezone
from urllib.parse import parse_qs
from typing import Any

try:
    import uvicorn
except ImportError:
    uvicorn = None  # type: ignore[assignment]

from dotenv import load_dotenv

load_dotenv()

from core.database import DatabaseRouter
from core.memory import MemoryStore
from core.agent_store import AgentRunStore
from core.session_manager import SessionManager
from core.version import get_version
from src.bridge_security import (
    RequestBodyTooLarge,
    is_authenticated,
    read_json as _read_json,
)
from router.agent import AgentQueueFull, AgentRunner
from router.router import InferenceRequest, InferenceResponse, Message, Router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [bridge] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("telegram_bridge")

_BRIDGE_HOST = os.environ.get("BRIDGE_HOST", "127.0.0.1")
_BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "5000"))
_BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "").strip()
_database = DatabaseRouter()
_session_manager = SessionManager(_database)
_memory_store = MemoryStore(_database)
_router = Router(memory_store=_memory_store, session_manager=_session_manager)
_agent_store = AgentRunStore(_database)
_agent_runner = AgentRunner(_router, _agent_store)
_control_queue: asyncio.Queue[dict[str, str]] = asyncio.Queue(maxsize=1)


def _json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def _response_payload(response: InferenceResponse) -> dict[str, Any]:
    return {
        "content": response.content,
        "model": response.model,
        "provider": response.provider,
        "prompt_tokens": response.prompt_tokens,
        "completion_tokens": response.completion_tokens,
        "finish_reason": response.finish_reason,
        "thinking": response.thinking,
    }


def _run_payload(run_id: str) -> dict[str, Any]:
    run = _agent_runner.get(run_id)
    if run is None:
        raise KeyError(run_id)
    payload: dict[str, Any] = {"run_id": run.run_id, "status": run.status}
    if run.result is not None:
        payload["result"] = _response_payload(run.result)
    if run.error is not None:
        payload["error"] = run.error
    return payload


def _version() -> str:
    try:
        return get_version()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        log.exception("Could not read or derive ZEUS version.")
        return "unknown"


def _format_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def _parse_messages(raw: Any) -> list[Message]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("'messages' must be a non-empty list")
    messages: list[Message] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each message must be an object")
        messages.append(Message(
            role=str(item.get("role", "user")),
            content=str(item.get("content", "")),
        ))
    return messages


def _inference_request(body: dict[str, Any]) -> InferenceRequest:
    messages = _parse_messages(body.get("messages"))
    return InferenceRequest(
        messages=messages,
        model=body.get("model") or None,
        provider_name=body.get("provider") or None,
        stream=bool(body.get("stream", False)),
        temperature=body.get("temperature"),
        max_tokens=body.get("max_tokens"),
        platform=str(body.get("platform") or "telegram"),
        extra={
            key: value for key, value in body.items()
            if key not in {
                "messages", "model", "provider", "stream", "temperature",
                "max_tokens", "personality", "platform", "session",
            }
        },
    )


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


class BridgeApplication:
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
                await _agent_store.initialize()
                await _memory_store.start()
                await _agent_runner.start()
                await send({"type": "lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                await _agent_runner.stop()
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
        if not _BRIDGE_TOKEN:
            await _send_json(
                send,
                {"error": "Bridge authentication is not configured"},
                status=503,
            )
            return
        if not is_authenticated(scope, _BRIDGE_TOKEN):
            await _send_json(send, {"error": "Bearer token required"}, status=401)
            return
        if method == "GET" and path == "/providers":
            await _send_json(send, {"available": await _router.available_providers()})
            return
        if method == "GET" and path == "/models":
            await _send_json(send, {"models": await _router.available_models()})
            return
        if method == "GET" and path == "/status":
            query = parse_qs(scope.get("query_string", b"").decode("ascii", errors="replace"))
            platform = query.get("platform", ["telegram"])[0]
            conversation_id = query.get("conversation_id", [""])[0]
            session = (
                await _session_manager.get_session(platform, conversation_id)
                if conversation_id else None
            )
            usage = session.metadata.get("usage", {}) if session else {}
            if not isinstance(usage, dict):
                usage = {}
            session_totals = (
                await _session_manager.get_usage(platform, conversation_id)
                if session else {}
            )
            model_status = await _router.model_manager.status()
            await _send_json(send, {
                "version": _version(),
                "session": ({
                    "id": session.session_id,
                    "conversation_id": session.conversation_id,
                    "status": session.status,
                    "updated_at": _format_timestamp(session.last_message_at or session.updated_at),
                    "prompt_tokens": int(session_totals.get("prompt_tokens", 0)),
                    "completion_tokens": int(session_totals.get("completion_tokens", 0)),
                    "last_prompt_tokens": int(usage.get("last_prompt_tokens", 0)),
                    "last_completion_tokens": int(usage.get("last_completion_tokens", 0)),
                    "context_length": usage.get("context_length"),
                    "model": usage.get("model"),
                    "provider": usage.get("provider"),
                } if session else None),
                "model_cache": _router.model_manager.cache_status(),
                "model": model_status,
                "agent": _agent_runner.status(),
            })
            return
        if method == "GET" and path == "/control/next":
            try:
                control = _control_queue.get_nowait()
            except asyncio.QueueEmpty:
                control = None
            await _send_json(send, control or {"action": None, "platform": None})
            return
        if method == "GET" and path == "/sessions/usage":
            query = parse_qs(scope.get("query_string", b"").decode("ascii", errors="replace"))
            platform = query.get("platform", ["telegram"])[0]
            conversation_id = query.get("conversation_id", [""])[0]
            if not conversation_id:
                await _send_json(send, {"error": "conversation_id is required"}, status=400)
                return
            usage = await _session_manager.get_usage(platform, conversation_id)
            await _send_json(send, usage)
            return
        if method == "GET" and path == "/sessions/retry":
            query = parse_qs(scope.get("query_string", b"").decode("ascii", errors="replace") )
            platform = query.get("platform", ["telegram"])[0]
            conversation_id = query.get("conversation_id", [""])[0]
            if not conversation_id:
                await _send_json(send, {"error": "conversation_id is required"}, status=400)
                return
            prompt = await _session_manager.get_retry_prompt(platform, conversation_id)
            await _send_json(send, {"message": prompt})
            return
        if method == "POST" and path == "/sessions/reset":
            try:
                body = await _read_json(receive)
            except RequestBodyTooLarge as exc:
                await _send_json(send, {"error": str(exc)}, status=413)
                return
            except ValueError as exc:
                await _send_json(send, {"error": str(exc)}, status=400)
                return
            platform = str(body.get("platform") or "telegram")
            conversation_id = str(body.get("conversation_id") or "")
            if not conversation_id:
                await _send_json(send, {"error": "conversation_id is required"}, status=400)
                return
            reset = await _session_manager.reset_session(platform, conversation_id)
            await _send_json(send, {"reset": reset})
            return

        if method == "POST" and path == "/control":
            try:
                body = await _read_json(receive)
            except RequestBodyTooLarge as exc:
                await _send_json(send, {"error": str(exc)}, status=413)
                return
            except ValueError as exc:
                await _send_json(send, {"error": str(exc)}, status=400)
                return
            action = body.get("action")
            if action not in {"restart", "stop"}:
                await _send_json(send, {"error": "action must be restart or stop"}, status=400)
                return
            platform = str(body.get("platform") or "telegram")
            if platform not in {"discord", "telegram"}:
                await _send_json(send, {"error": "platform must be discord or telegram"}, status=400)
                return
            try:
                _control_queue.put_nowait({"action": action, "platform": platform})
            except asyncio.QueueFull:
                await _send_json(send, {"error": "A supervisor action is already pending."}, status=409)
                return
            await _send_json(
                send,
                {"accepted": True, "action": action, "platform": platform},
                status=202,
            )
            return

        if method == "GET" and path.startswith("/agent/runs/"):
            run_id = path.removeprefix("/agent/runs/")
            try:
                payload = _run_payload(run_id)
            except KeyError:
                await _send_json(send, {"error": "Agent run not found"}, status=404)
                return
            status = 202 if payload["status"] in {"queued", "running"} else 200
            await _send_json(send, payload, status=status)
            return

        if method == "POST" and path in {"/infer", "/agent/run"}:
            try:
                body = await _read_json(receive)
                request = _inference_request(body)
            except RequestBodyTooLarge as exc:
                await _send_json(send, {"error": str(exc)}, status=413)
                return
            except ValueError as exc:
                await _send_json(send, {"error": str(exc)}, status=400)
                return

            session_data = body.get("session")
            if session_data is not None:
                if not isinstance(session_data, dict):
                    await _send_json(send, {"error": "'session' must be an object"}, status=400)
                    return
                metadata = session_data.get("metadata", {})
                if not isinstance(metadata, dict):
                    await _send_json(send, {"error": "'session.metadata' must be an object"}, status=400)
                    return
                try:
                    session = await _session_manager.open_session(
                        platform=str(session_data.get("platform") or request.platform),
                        conversation_id=str(session_data.get("conversation_id") or ""),
                        user_id=(
                            str(session_data["user_id"])
                            if session_data.get("user_id") is not None else None
                        ),
                        metadata=metadata,
                    )
                except ValueError as exc:
                    await _send_json(send, {"error": str(exc)}, status=400)
                    return
                except Exception as exc:
                    log.exception("Could not open conversation session")
                    await _send_json(
                        send,
                        {"error": f"Could not access the conversation session: {exc}"},
                        status=503,
                    )
                    return
                request.session = session

            if path == "/agent/run":
                try:
                    run = await _agent_runner.submit(request)
                except AgentQueueFull as exc:
                    await _send_json(send, {"error": str(exc)}, status=503)
                    return
                except RuntimeError as exc:
                    await _send_json(send, {"error": str(exc)}, status=503)
                    return
                await _send_json(
                    send,
                    {"run_id": run.run_id, "status": run.status},
                    status=202,
                )
                return

            try:
                response = await _router.route(request)
            except RuntimeError as exc:
                log.error("Inference failed: %s", func)
                await _send_json(send, {"error": str(exc)}, status=503)
            except Exception as exc:
                log.exception("Unexpected error during inference")
                await _send_json(send, {"error": str(exc)}, status=500)
                return
            else:
                await _send_json(send, _response_payload(response))
            return

        await _send_json(send, {"error": "Not found"}, status=404)


def create_app() -> BridgeApplication:
    return BridgeApplication()


def main() -> None:
    if uvicorn is None:
        raise RuntimeError("uvicorn is required: install the project requirements")
    uvicorn.run(create_app(), host=_BRIDGE_HOST, port=_BRIDGE_PORT, log_config=None)


if __name__ == "__main__":
    main()

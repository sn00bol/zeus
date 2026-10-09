"""WebUI chat submission and persistence orchestration."""

from __future__ import annotations

from typing import Any

from core.session_manager import SessionManager
from router.router import InferenceRequest, Message

from .loops import ModelLoop
from .respond_inter import assistant_message
from .runner import StreamRunner

PLATFORM = "webui"
_DELTA_CHUNK_CHARS = 48


class ChatHandler:
    def __init__(
        self,
        session_manager: SessionManager,
        model_loop: ModelLoop,
        stream_runner: StreamRunner,
    ) -> None:
        self._sessions = session_manager
        self._model_loop = model_loop
        self._streams = stream_runner

    async def submit(
        self,
        conversation_id: str,
        message: str,
        *,
        provider: str | None = None,
        model: str | None = None,
    ) -> str:
        user_id = f"webui-{conversation_id}"
        session = await self._sessions.open_session(
            PLATFORM,
            conversation_id,
            user_id=user_id,
        )
        await self._sessions.append_message({
            "platform": PLATFORM,
            "conversation_id": conversation_id,
            "message_id": _new_message_id(),
            "role": "user",
            "content": message,
            "user_id": user_id,
            "timestamp": _timestamp(),
        })
        history = await self._sessions.get_history(PLATFORM, conversation_id, limit=100)
        request = InferenceRequest(
            messages=[
                Message(role=item["role"], content=str(item.get("content", "")))
                for item in history
            ],
            model=model,
            provider_name=provider,
            platform=PLATFORM,
            session=session,
        )

        async def run(publish: Any) -> None:
            publish("ui_control", {"state": "thinking"})
            pending_text = ""

            async def on_delta(text: str) -> None:
                nonlocal pending_text
                pending_text += text
                while len(pending_text) >= _DELTA_CHUNK_CHARS:
                    publish("delta", {"text": pending_text[:_DELTA_CHUNK_CHARS]})
                    pending_text = pending_text[_DELTA_CHUNK_CHARS:]

            result = await self._model_loop.respond(request, on_delta)
            if pending_text:
                publish("delta", {"text": pending_text})
            saved_message = assistant_message(
                platform=PLATFORM,
                conversation_id=conversation_id,
                user_id=user_id,
                response=result,
            )
            await self._sessions.append_message(saved_message)
            publish("streamaddon", {
                "provider": result.provider,
                "model": result.model,
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
            })
            publish("ui_control", {"state": "complete"})
            publish("done", {"message": saved_message})

        return self._streams.start(conversation_id, run)


def _new_message_id() -> str:
    from uuid import uuid4

    return str(uuid4())


def _timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()

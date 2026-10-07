"""Conversation session lifecycle orchestration for platform adapters."""

from __future__ import annotations

from typing import Any

from .database import DatabaseRouter
from .session import Session, SessionStore


class SessionManager:
    """Keep active session state synchronized with the persistent session store."""

    def __init__(self, database: DatabaseRouter) -> None:
        self._store = SessionStore(database)
        self._active: dict[tuple[str, str], Session] = {}

    async def open_session(
        self,
        platform: str,
        conversation_id: str,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Session:
        session = await self._store.get_or_create(
            platform, conversation_id, user_id, metadata,
        )
        self._active[(session.platform, session.conversation_id)] = session
        return session

    async def get_session(self, platform: str, conversation_id: str) -> Session | None:
        platform = platform.strip().lower()
        conversation_id = conversation_id.strip()
        session = await self._store.get(platform, conversation_id)
        key = (platform, conversation_id)
        if session is None or session.status != "active":
            self._active.pop(key, None)
            return session
        self._active[key] = session
        return session

    async def update_session(
        self,
        session_id: int,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> Session | None:
        session = await self._store.update(session_id, metadata=metadata)
        if session is not None and session.status == "active":
            self._active[(session.platform, session.conversation_id)] = session
        return session

    async def close_session(self, session_id: int) -> Session | None:
        session = await self._store.update(session_id, status="closed")
        if session is not None:
            self._active.pop((session.platform, session.conversation_id), None)
        return session

    async def append_message(self, entry: dict[str, Any]) -> bool:
        inserted = await self._store.append_message(entry)
        key = (
            str(entry.get("platform", "")).strip().lower(),
            str(entry.get("conversation_id", "")).strip(),
        )
        if key[0] and key[1]:
            session = await self._store.get(*key)
            if session is not None:
                self._active[key] = session
        return inserted

    async def get_history(
        self,
        platform: str,
        conversation_id: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        return await self._store.get_messages(platform, conversation_id, limit)

    async def reset_session(self, platform: str, conversation_id: str) -> bool:
        reset = await self._store.reset(platform, conversation_id)
        key = (platform.strip().lower(), conversation_id.strip())
        self._active.pop(key, None)
        return reset

    async def get_usage(self, platform: str, conversation_id: str) -> dict[str, int]:
        return await self._store.usage(platform, conversation_id)

    async def get_retry_prompt(
        self,
        platform: str,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        return await self._store.latest_retry_prompt(platform, conversation_id)

    async def record_usage(
        self,
        session: Session,
        *,
        prompt_tokens: int,
        completion_tokens: int,
        provider: str,
        model: str,
        context_length: int | None,
    ) -> None:
        await self._store.record_usage(
            session.session_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            provider=provider,
            model=model,
            context_length=context_length,
        )

    async def shutdown(self) -> None:
        self._active.clear()

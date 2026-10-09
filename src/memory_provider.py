"""Narrow memory-provider interface over the shared conversation memory store."""

from __future__ import annotations

from core.memory import MemoryStore


class MemoryProvider:
    def __init__(self, store: MemoryStore) -> None:
        self._store = store

    async def recall(self, *, platform: str, user_id: str, query: str) -> list[str]:
        return await self._store.retrieve(
            platform=platform,
            user_id=user_id,
            query=query,
        )

    async def remember(
        self,
        *,
        platform: str,
        user_id: str,
        conversation_id: str,
        question: str,
        answer: str,
    ) -> bool:
        return await self._store.remember_turn(
            platform=platform,
            user_id=user_id,
            conversation_id=conversation_id,
            question=question,
            answer=answer,
        )

    async def forget(self, *, platform: str, user_id: str) -> int:
        return await self._store.forget_user(platform=platform, user_id=user_id)

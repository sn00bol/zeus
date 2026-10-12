"""Narrow memory-provider interface over the shared conversation memory store."""

from __future__ import annotations

from vendor.memories.store import MemoryBridge, MemoryStoreLike


class MemoryProvider:
    def __init__(self, store: MemoryStoreLike) -> None:
        self._bridge = MemoryBridge(store)

    async def recall(self, *, platform: str, user_id: str, query: str) -> list[str]:
        recalled = await self._bridge.recall_history(
            platform=platform,
            user_id=user_id,
            query=query,
        )
        return [entry.content for entry in recalled.entries]

    async def remember(
        self,
        *,
        platform: str,
        user_id: str,
        conversation_id: str,
        question: str,
        answer: str,
    ) -> bool:
        return await self._bridge.remember_turn(
            platform=platform,
            user_id=user_id,
            conversation_id=conversation_id,
            question=question,
            answer=answer,
        )

    async def forget(self, *, platform: str, user_id: str) -> int:
        return await self._bridge.forget(platform=platform, user_id=user_id)

    async def remember_fact(self, *, platform: str, user_id: str, content: str) -> bool:
        return await self._bridge.remember_fact(
            platform=platform,
            user_id=user_id,
            content=content,
        )

    async def recall_facts(self, *, platform: str, user_id: str, query: str) -> list[str]:
        recalled = await self._bridge.recall_facts(
            platform=platform,
            user_id=user_id,
            query=query,
        )
        return [entry.content for entry in recalled.entries]

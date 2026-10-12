"""Adapter for core.memory.MemoryStore; PostgreSQL ownership remains in core."""

from __future__ import annotations

from typing import Protocol

from .schema import MemoryEntry, MemoryKind, RecallResult


class MemoryStoreLike(Protocol):
    async def retrieve(self, *, platform: str, user_id: str, query: str) -> list[str]: ...

    async def retrieve_facts(
        self,
        *,
        platform: str,
        user_id: str,
        query: str,
    ) -> list[str]: ...

    async def remember_turn(
        self,
        *,
        platform: str,
        user_id: str,
        conversation_id: str,
        question: str,
        answer: str,
    ) -> bool: ...

    async def forget_user(self, *, platform: str, user_id: str) -> int: ...


class MemoryBridge:
    def __init__(self, store: MemoryStoreLike) -> None:
        self._store = store

    async def recall_history(
        self,
        *,
        platform: str,
        user_id: str,
        query: str,
    ) -> RecallResult:
        values = await self._store.retrieve(platform=platform, user_id=user_id, query=query)
        return RecallResult(
            tuple(MemoryEntry(content=value, kind=MemoryKind.CONVERSATION_TURN)
                  for value in values),
            query,
        )

    async def recall_facts(
        self,
        *,
        platform: str,
        user_id: str,
        query: str,
    ) -> RecallResult:
        retrieve_facts = getattr(self._store, "retrieve_facts", None)
        if retrieve_facts is None:
            return RecallResult((), query)
        values = await retrieve_facts(platform=platform, user_id=user_id, query=query)
        return RecallResult(
            tuple(MemoryEntry(content=value, kind=MemoryKind.EXTRACTED_FACT)
                  for value in values),
            query,
        )

    async def remember_turn(
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

    async def remember_fact(self, *, platform: str, user_id: str, content: str) -> bool:
        remember_fact = getattr(self._store, "remember_fact", None)
        if remember_fact is None:
            raise NotImplementedError("The configured memory store does not support extracted facts.")
        return await remember_fact(
            platform=platform,
            user_id=user_id,
            content=content,
        )

    async def forget(self, *, platform: str, user_id: str) -> int:
        return await self._store.forget_user(platform=platform, user_id=user_id)

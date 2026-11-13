"""User-scoped, expiring conversation memory backed by PostgreSQL full-text search."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime

from .database import DatabaseRouter

log = logging.getLogger(__name__)

_TOKEN_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)
_MAX_QUESTION_LENGTH = 2_000
_MAX_ANSWER_LENGTH = 4_000
_STOP_WORDS = {
    "a", "about", "an", "and", "are", "as", "at", "be", "but", "by",
    "cach", "cho", "co", "cua", "de", "do", "duoc", "gi", "hay",
    "how", "i", "in", "is", "it", "la", "lam", "me", "mot", "nao",
    "nay", "nguoi", "of", "on", "or", "project", "the", "this", "to",
    "toi", "tren", "tu", "va", "voi", "what", "when", "where", "who",
    "why", "with", "you",
}


class MemoryStore:
    """Store conversation turns and explicitly extracted facts in separate tables."""

    def __init__(
        self,
        database: DatabaseRouter,
        *,
        retention_days: int = 30,
        max_results: int = 3,
        cleanup_interval_seconds: float = 3_600,
    ) -> None:
        if retention_days < 1:
            raise ValueError("Memory retention must be at least one day.")
        if max_results < 1:
            raise ValueError("Memory retrieval must return at least one result.")
        if cleanup_interval_seconds <= 0:
            raise ValueError("Memory cleanup interval must be greater than zero.")
        self._database = database
        self._retention_days = retention_days
        self._max_results = max_results
        self._cleanup_interval_seconds = cleanup_interval_seconds
        self._cleanup_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._cleanup_task is not None:
            return
        await self.prune_expired()
        self._cleanup_task = asyncio.create_task(
            self._cleanup_loop(),
            name="conversation-memory-cleanup",
        )

    async def stop(self) -> None:
        task, self._cleanup_task = self._cleanup_task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(self._cleanup_interval_seconds)
            try:
                await self.prune_expired()
            except Exception:
                log.exception("Could not remove expired conversation memories.")

    async def prune_expired(self) -> int:
        results = await asyncio.gather(
            self._database.execute(
                "DELETE FROM conversation_memories WHERE expires_at <= NOW()"
            ),
            self._database.execute(
                "DELETE FROM extracted_memories WHERE expires_at <= NOW()"
            ),
        )
        return sum(_affected_rows(result) for result in results)

    async def remember_turn(
        self,
        *,
        platform: str,
        user_id: str,
        conversation_id: str,
        question: str,
        answer: str,
    ) -> bool:
        _validate_identity(platform, user_id, conversation_id)
        question = question.strip()
        answer = answer.strip()
        if not question or not answer:
            return False
        question = question[:_MAX_QUESTION_LENGTH]
        answer = answer[:_MAX_ANSWER_LENGTH]

        result = await self._database.fetchrow("""
            INSERT INTO conversation_memories
                (platform, user_id, conversation_id, content, expires_at)
            VALUES (
                $1, $2, $3, $4,
                NOW() + ($5::integer * INTERVAL '1 day')
            )
            RETURNING memory_id
        """, platform.strip().lower(), user_id.strip(), conversation_id.strip(),
            f"User asked: {question}\nZEUS answered: {answer}", self._retention_days)
        return result is not None

    async def retrieve(
        self,
        *,
        platform: str,
        user_id: str,
        query: str,
    ) -> list[str]:
        _validate_identity(platform, user_id)
        terms = [
            token.lower() for token in _TOKEN_PATTERN.findall(query)
            if token.lower() not in _STOP_WORDS and len(token) > 1
        ][:12]
        ts_query = " | ".join(terms)
        records = await self._database.fetch("""
            WITH relevant AS (
                SELECT memory_id, conversation_id, content,
                       ts_rank(search_vector, to_tsquery('simple', $3)) AS relevance,
                       created_at AS sort_at
                FROM conversation_memories
                WHERE platform = $1 AND user_id = $2
                  AND expires_at > NOW()
                  AND $3 <> ''
                  AND search_vector @@ to_tsquery('simple', $3)
                ORDER BY relevance DESC, updated_at DESC
                LIMIT $4
            ), recent_activity AS (
                SELECT conversation_id, MAX(created_at) AS last_activity
                FROM conversation_memories
                WHERE platform = $1 AND user_id = $2
                  AND expires_at > NOW()
                  AND NOT EXISTS (
                      SELECT 1
                      FROM relevant
                      WHERE relevant.conversation_id = conversation_memories.conversation_id
                  )
                GROUP BY conversation_id
                ORDER BY last_activity DESC
                LIMIT $4
            ), recent AS (
                SELECT DISTINCT ON (memory.conversation_id)
                       memory.memory_id, memory.conversation_id, memory.content,
                       0::real AS relevance, recent_activity.last_activity AS sort_at
                FROM conversation_memories AS memory
                JOIN recent_activity USING (conversation_id)
                WHERE memory.platform = $1 AND memory.user_id = $2
                  AND memory.expires_at > NOW()
                ORDER BY memory.conversation_id, memory.created_at, memory.memory_id
            ), candidates AS (
                SELECT * FROM relevant
                UNION ALL
                SELECT * FROM recent
            ), ranked AS (
                SELECT memory_id, content, relevance, sort_at
                FROM candidates
                ORDER BY relevance DESC, sort_at DESC
                LIMIT $4
            )
            UPDATE conversation_memories AS memory
            SET expires_at = NOW() + ($5::integer * INTERVAL '1 day'),
                updated_at = NOW()
            FROM ranked
            WHERE memory.memory_id = ranked.memory_id
            RETURNING ranked.content, ranked.relevance, ranked.sort_at
        """, platform.strip().lower(), user_id.strip(), ts_query,
            self._max_results, self._retention_days)
        ranked = sorted(
            records,
            key=lambda record: (
                float(record["relevance"]),
                record["sort_at"].timestamp()
                if isinstance(record.get("sort_at"), datetime)
                else 0.0,
            ),
            reverse=True,
        )
        return [str(record["content"]) for record in ranked]

    async def remember_fact(
        self,
        *,
        platform: str,
        user_id: str,
        content: str,
    ) -> bool:
        """Persist an explicitly extracted fact separately from conversation turns."""
        _validate_identity(platform, user_id)
        content = content.strip()
        if not content:
            return False
        content = content[:_MAX_ANSWER_LENGTH]
        result = await self._database.fetchrow("""
            INSERT INTO extracted_memories
                (platform, user_id, content, expires_at)
            VALUES ($1, $2, $3, NOW() + ($4::integer * INTERVAL '1 day'))
            RETURNING memory_id
        """, platform.strip().lower(), user_id.strip(), content, self._retention_days)
        return result is not None

    async def retrieve_facts(
        self,
        *,
        platform: str,
        user_id: str,
        query: str,
    ) -> list[str]:
        """Retrieve curated facts without mixing them with raw conversation history."""
        _validate_identity(platform, user_id)
        terms = [
            token.lower() for token in _TOKEN_PATTERN.findall(query)
            if token.lower() not in _STOP_WORDS and len(token) > 1
        ][:12]
        if not terms:
            return []

        records = await self._database.fetch("""
            WITH candidates AS (
                SELECT memory_id, content,
                       ts_rank(search_vector, to_tsquery('simple', $3)) AS relevance
                FROM extracted_memories
                WHERE platform = $1 AND user_id = $2
                  AND expires_at > NOW()
                  AND search_vector @@ to_tsquery('simple', $3)
                ORDER BY relevance DESC, updated_at DESC
                LIMIT $4
            )
            UPDATE extracted_memories AS memory
            SET expires_at = NOW() + ($5::integer * INTERVAL '1 day'),
                updated_at = NOW()
            FROM candidates
            WHERE memory.memory_id = candidates.memory_id
            RETURNING candidates.content, candidates.relevance
        """, platform.strip().lower(), user_id.strip(), " | ".join(terms),
            self._max_results, self._retention_days)
        ranked = sorted(records, key=lambda record: float(record["relevance"]), reverse=True)
        return [str(record["content"]) for record in ranked]

    async def forget_user(self, *, platform: str, user_id: str) -> int:
        _validate_identity(platform, user_id)
        results = await asyncio.gather(
            self._database.execute("""
                DELETE FROM conversation_memories
                WHERE platform = $1 AND user_id = $2
            """, platform.strip().lower(), user_id.strip()),
            self._database.execute("""
                DELETE FROM extracted_memories
                WHERE platform = $1 AND user_id = $2
            """, platform.strip().lower(), user_id.strip()),
        )
        return sum(_affected_rows(result) for result in results)


def _affected_rows(result: str) -> int:
    try:
        return int(result.rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0


def _validate_identity(platform: str, user_id: str, conversation_id: str | None = None) -> None:
    if not platform.strip() or not user_id.strip():
        raise ValueError("Platform and user ID are required for private memory.")
    if conversation_id is not None and not conversation_id.strip():
        raise ValueError("Conversation ID is required to save a memory.")

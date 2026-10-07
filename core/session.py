"""Persistent, platform-neutral conversation session records and history."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .database import DatabaseRouter


@dataclass(frozen=True)
class Session:
    session_id: int
    platform: str
    conversation_id: str
    user_id: str | None
    status: str
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None

    @classmethod
    def from_record(cls, record: Any) -> Session:
        metadata = record["metadata"]
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        return cls(
            session_id=int(record["session_id"]),
            platform=record["platform"],
            conversation_id=record["conversation_id"],
            user_id=record["user_id"],
            status=record["status"],
            metadata=metadata if isinstance(metadata, dict) else {},
            created_at=record["created_at"],
            updated_at=record["updated_at"],
            last_message_at=record["last_message_at"],
        )


class SessionStore:
    """Read and write sessions and messages in the shared PostgreSQL schema."""

    def __init__(self, database: DatabaseRouter) -> None:
        self._database = database

    async def get_or_create(
        self,
        platform: str,
        conversation_id: str,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Session:
        platform, conversation_id = _normalize_identity(platform, conversation_id)
        record = await self._database.fetchrow("""
            INSERT INTO chat_sessions
                (platform, conversation_id, user_id, status, metadata)
            VALUES ($1, $2, $3, 'active', $4::jsonb)
            ON CONFLICT (platform, conversation_id) DO UPDATE
            SET user_id = COALESCE(EXCLUDED.user_id, chat_sessions.user_id),
                status = 'active',
                metadata = chat_sessions.metadata || EXCLUDED.metadata,
                updated_at = NOW()
            RETURNING session_id, platform, conversation_id, user_id, status,
                      metadata, created_at, updated_at, last_message_at
        """, platform, conversation_id, user_id, json.dumps(metadata or {}))
        if record is None:
            raise RuntimeError("PostgreSQL did not return the session record.")
        return Session.from_record(record)

    async def get(
        self,
        platform: str,
        conversation_id: str,
    ) -> Session | None:
        platform, conversation_id = _normalize_identity(platform, conversation_id)
        record = await self._database.fetchrow("""
            SELECT session_id, platform, conversation_id, user_id, status,
                   metadata, created_at, updated_at, last_message_at
            FROM chat_sessions
            WHERE platform = $1 AND conversation_id = $2
        """, platform, conversation_id)
        return Session.from_record(record) if record is not None else None

    async def update(
        self,
        session_id: int,
        *,
        metadata: dict[str, Any] | None = None,
        status: str | None = None,
    ) -> Session | None:
        if status is not None and status not in {"active", "closed"}:
            raise ValueError("Session status must be 'active' or 'closed'.")
        record = await self._database.fetchrow("""
            UPDATE chat_sessions
            SET metadata = metadata || $2::jsonb,
                status = COALESCE($3, status),
                updated_at = NOW()
            WHERE session_id = $1
            RETURNING session_id, platform, conversation_id, user_id, status,
                      metadata, created_at, updated_at, last_message_at
        """, session_id, json.dumps(metadata or {}), status)
        return Session.from_record(record) if record is not None else None

    async def append_message(self, entry: dict[str, Any]) -> bool:
        platform = str(entry.get("platform", ""))
        conversation_id = str(entry.get("conversation_id", ""))
        role = str(entry.get("role", ""))
        if role not in {"system", "user", "assistant"}:
            raise ValueError("Message role must be system, user, or assistant.")
        platform, conversation_id = _normalize_identity(platform, conversation_id)

        message_id = str(entry.get("message_id") or uuid4())
        timestamp = entry.get("timestamp") or datetime.now(timezone.utc)
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        payload = {**entry, "platform": platform, "conversation_id": conversation_id,
                   "message_id": message_id, "role": role,
                   "content": str(entry.get("content") or ""),
                   "timestamp": timestamp.isoformat()}
        user_id = str(entry["user_id"]) if role == "user" and entry.get("user_id") else None
        record = await self._database.fetchrow("""
            WITH inserted AS (
                INSERT INTO chat_messages
                    (platform, conversation_id, message_id, role, payload, created_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
                ON CONFLICT (platform, message_id) DO NOTHING
                RETURNING 1
            ), session_upsert AS (
                INSERT INTO chat_sessions
                    (platform, conversation_id, user_id, status, metadata, last_message_at)
                VALUES ($1, $2, $7, 'active', $8::jsonb, $6::timestamptz)
                ON CONFLICT (platform, conversation_id) DO UPDATE
                SET user_id = COALESCE(EXCLUDED.user_id, chat_sessions.user_id),
                    status = 'active',
                    metadata = chat_sessions.metadata || EXCLUDED.metadata,
                    updated_at = NOW(),
                    last_message_at = GREATEST(chat_sessions.last_message_at, EXCLUDED.last_message_at)
                RETURNING 1
            )
            SELECT EXISTS (SELECT 1 FROM inserted) AS inserted
        """, platform, conversation_id, message_id, role, json.dumps(payload),
            timestamp, user_id, json.dumps(entry.get("metadata") or {}))
        return bool(record["inserted"]) if record is not None else False

    async def get_messages(
        self,
        platform: str,
        conversation_id: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        platform, conversation_id = _normalize_identity(platform, conversation_id)
        if not 1 <= limit <= 100:
            raise ValueError("History limit must be between 1 and 100.")
        records = await self._database.fetch("""
            SELECT payload
            FROM chat_messages
            WHERE platform = $1 AND conversation_id = $2
            ORDER BY created_at DESC, id DESC
            LIMIT $3
        """, platform, conversation_id, limit)
        messages: list[dict[str, Any]] = []
        for record in records:
            payload = record["payload"]
            messages.append(json.loads(payload) if isinstance(payload, str) else payload)
        return list(reversed(messages))

    async def reset(self, platform: str, conversation_id: str) -> bool:
        platform, conversation_id = _normalize_identity(platform, conversation_id)
        client = await self._database.pool.acquire()
        try:
            async with client.transaction():
                await client.execute("""
                    DELETE FROM chat_messages
                    WHERE platform = $1 AND conversation_id = $2
                """, platform, conversation_id)
                record = await client.fetchrow("""
                    UPDATE chat_sessions
                    SET metadata = metadata - 'usage',
                        last_message_at = NULL,
                        status = 'active',
                        updated_at = NOW()
                    WHERE platform = $1 AND conversation_id = $2
                    RETURNING session_id
                """, platform, conversation_id)
            return record is not None
        finally:
            await self._database.pool.release(client)

    async def usage(self, platform: str, conversation_id: str) -> dict[str, int]:
        platform, conversation_id = _normalize_identity(platform, conversation_id)
        record = await self._database.fetchrow("""
            SELECT
                COALESCE(SUM(NULLIF(payload->'usage'->>'prompt_tokens', '')::BIGINT), 0)::BIGINT AS prompt_tokens,
                COALESCE(SUM(NULLIF(payload->'usage'->>'completion_tokens', '')::BIGINT), 0)::BIGINT AS completion_tokens
            FROM chat_messages
            WHERE platform = $1 AND conversation_id = $2 AND role = 'assistant'
        """, platform, conversation_id)
        return {
            "prompt_tokens": int(record["prompt_tokens"]) if record else 0,
            "completion_tokens": int(record["completion_tokens"]) if record else 0,
        }

    async def record_usage(
        self,
        session_id: int,
        *,
        prompt_tokens: int,
        completion_tokens: int,
        provider: str,
        model: str,
        context_length: int | None,
    ) -> None:
        await self._database.execute("""
            UPDATE chat_sessions
            SET metadata = jsonb_set(
                metadata,
                '{usage}',
                COALESCE(metadata->'usage', '{}'::jsonb) || jsonb_build_object(
                    'prompt_tokens',
                    COALESCE((metadata->'usage'->>'prompt_tokens')::BIGINT, 0) + $2::BIGINT,
                    'completion_tokens',
                    COALESCE((metadata->'usage'->>'completion_tokens')::BIGINT, 0) + $3::BIGINT,
                    'last_prompt_tokens', $2::BIGINT,
                    'last_completion_tokens', $3::BIGINT,
                    'provider', $4::TEXT,
                    'model', $5::TEXT,
                    'context_length', $6::BIGINT,
                    'updated_at', NOW()
                )
            ),
            updated_at = NOW()
            WHERE session_id = $1
        """, session_id, prompt_tokens, completion_tokens, provider, model, context_length)

    async def latest_retry_prompt(
        self,
        platform: str,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        platform, conversation_id = _normalize_identity(platform, conversation_id)
        record = await self._database.fetchrow("""
            WITH latest_user AS (
                SELECT id, created_at, payload
                FROM chat_messages
                WHERE platform = $1 AND conversation_id = $2 AND role = 'user'
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            )
            SELECT latest_user.payload
            FROM latest_user
            WHERE NOT EXISTS (
                SELECT 1
                FROM chat_messages AS assistant
                WHERE assistant.platform = $1
                  AND assistant.conversation_id = $2
                  AND assistant.role = 'assistant'
                  AND (assistant.created_at, assistant.id)
                      > (latest_user.created_at, latest_user.id)
            )
        """, platform, conversation_id)
        if record is None:
            return None
        payload = record["payload"]
        return json.loads(payload) if isinstance(payload, str) else payload


def _normalize_identity(platform: str, conversation_id: str) -> tuple[str, str]:
    if not platform.strip() or not conversation_id.strip():
        raise ValueError("Platform and conversation ID are required.")
    return platform.strip().lower(), conversation_id.strip()

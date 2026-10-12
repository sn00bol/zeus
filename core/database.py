"""Async PostgreSQL access shared by Python services and platform adapters, with in-memory fallback."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

log = logging.getLogger(__name__)


class InMemoryRecord(dict):
    """Dictionary subclass emulating an asyncpg.Record mapping."""
    pass


class InMemoryTransaction:
    async def __aenter__(self) -> InMemoryTransaction:
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        pass


class InMemoryConnection:
    """Emulates an acquired database connection from the pool."""

    def __init__(self, pool: InMemoryDatabasePool) -> None:
        self._pool = pool

    def transaction(self) -> InMemoryTransaction:
        return InMemoryTransaction()

    async def execute(self, query: str, *args: object) -> str:
        return await self._pool.execute(query, *args)

    async def fetch(self, query: str, *args: object) -> list[InMemoryRecord]:
        return await self._pool.fetch(query, *args)

    async def fetchrow(self, query: str, *args: object) -> InMemoryRecord | None:
        return await self._pool.fetchrow(query, *args)


class InMemoryDatabasePool:
    """
    Lightweight in-memory storage engine emulating PostgreSQL tables when PostgreSQL is unavailable.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._sessions: dict[tuple[str, str], InMemoryRecord] = {}
        self._session_counter = 1
        self._messages: list[InMemoryRecord] = []
        self._memories: list[InMemoryRecord] = []
        self._facts: list[InMemoryRecord] = []
        self._memory_counter = 1
        self._model_prefs: dict[str, InMemoryRecord] = {}
        self._user_settings: dict[tuple[str, str], bool] = {}
        self._help_prefs: dict[str, Any] = {}

    async def acquire(self) -> InMemoryConnection:
        return InMemoryConnection(self)

    async def release(self, conn: InMemoryConnection) -> None:
        pass

    async def close(self) -> None:
        pass

    async def execute(self, query: str, *args: object) -> str:
        async with self._lock:
            q = query.strip().upper()
            if "DELETE FROM CHAT_MESSAGES" in q and len(args) >= 2:
                plat, conv = str(args[0]), str(args[1])
                self._messages = [
                    m for m in self._messages
                    if not (m["platform"] == plat and m["conversation_id"] == conv)
                ]
                return "DELETE"
            if (
                "DELETE FROM CONVERSATION_MEMORIES" in q
                or "DELETE FROM EXTRACTED_MEMORIES" in q
            ):
                now = datetime.now(timezone.utc)
                collection = self._facts if "EXTRACTED_MEMORIES" in q else self._memories
                previous_count = len(collection)
                if "WHERE PLATFORM = $1 AND USER_ID = $2" in q and len(args) >= 2:
                    platform, user_id = str(args[0]), str(args[1])
                    collection[:] = [
                        item for item in collection
                        if not (item["platform"] == platform and item["user_id"] == user_id)
                    ]
                else:
                    collection[:] = [
                        item for item in collection if item.get("expires_at", now) > now
                    ]
                return f"DELETE {previous_count - len(collection)}"
            return "OK"

    async def fetchrow(self, query: str, *args: object) -> InMemoryRecord | None:
        async with self._lock:
            q = query.strip()
            upper_q = q.upper()

            # Health check ping
            if upper_q.rstrip("; ") == "SELECT 1":
                return InMemoryRecord({"val": 1})

            if "INSERT INTO CONVERSATION_MEMORIES" in upper_q and len(args) >= 5:
                platform, user_id, conversation_id, content, retention_days = args[:5]
                return self._insert_memory(
                    self._memories,
                    platform=str(platform),
                    user_id=str(user_id),
                    content=str(content),
                    retention_days=int(retention_days),
                    conversation_id=str(conversation_id),
                )

            if "INSERT INTO EXTRACTED_MEMORIES" in upper_q and len(args) >= 4:
                platform, user_id, content, retention_days = args[:4]
                return self._insert_memory(
                    self._facts,
                    platform=str(platform),
                    user_id=str(user_id),
                    content=str(content),
                    retention_days=int(retention_days),
                )

            # chat_messages WITH inserted AS ... session_upsert ...
            if ("WITH INSERTED AS" in upper_q or "INSERT INTO CHAT_MESSAGES" in upper_q) and len(args) >= 6:
                plat, conv, msg_id, role = str(args[0]), str(args[1]), str(args[2]), str(args[3])
                payload_arg, created_at = args[4], args[5]
                payload = json.loads(payload_arg) if isinstance(payload_arg, str) else payload_arg
                ts = created_at if isinstance(created_at, datetime) else datetime.now(timezone.utc)
                self._messages.append(InMemoryRecord({
                    "platform": plat,
                    "conversation_id": conv,
                    "message_id": msg_id,
                    "role": role,
                    "payload": payload,
                    "created_at": ts,
                }))
                # update session
                key = (plat, conv)
                if key in self._sessions:
                    self._sessions[key]["last_message_at"] = ts
                return InMemoryRecord({"inserted": True})

            # chat_sessions INSERT ... ON CONFLICT
            if "INSERT INTO CHAT_SESSIONS" in upper_q and len(args) >= 4:
                plat, conv, user_id = str(args[0]), str(args[1]), args[2]
                raw_meta = args[3]
                meta = json.loads(raw_meta) if isinstance(raw_meta, str) else (raw_meta or {})
                now = datetime.now(timezone.utc)
                key = (plat, conv)
                if key in self._sessions:
                    existing = self._sessions[key]
                    merged_meta = {**existing.get("metadata", {}), **meta}
                    existing["metadata"] = merged_meta
                    existing["user_id"] = user_id if user_id is not None else existing.get("user_id")
                    existing["status"] = "active"
                    existing["updated_at"] = now
                    return InMemoryRecord(existing)
                session_id = self._session_counter
                self._session_counter += 1
                rec = InMemoryRecord({
                    "session_id": session_id,
                    "platform": plat,
                    "conversation_id": conv,
                    "user_id": user_id,
                    "status": "active",
                    "metadata": meta,
                    "created_at": now,
                    "updated_at": now,
                    "last_message_at": None,
                })
                self._sessions[key] = rec
                return InMemoryRecord(rec)

            # chat_sessions SELECT
            if "FROM CHAT_SESSIONS" in upper_q and "WHERE PLATFORM = $1 AND CONVERSATION_ID = $2" in upper_q and len(args) >= 2:
                key = (str(args[0]), str(args[1]))
                rec = self._sessions.get(key)
                return InMemoryRecord(rec) if rec else None

            # chat_sessions UPDATE WHERE session_id = $1
            if "UPDATE CHAT_SESSIONS" in upper_q and "WHERE SESSION_ID = $1" in upper_q and len(args) >= 1:
                sess_id = int(args[0])
                raw_meta = args[1] if len(args) > 1 else None
                status = str(args[2]) if len(args) > 2 and args[2] is not None else None
                meta = json.loads(raw_meta) if isinstance(raw_meta, str) else (raw_meta or {})
                for key, rec in self._sessions.items():
                    if rec["session_id"] == sess_id:
                        if meta:
                            rec["metadata"] = {**rec.get("metadata", {}), **meta}
                        if status:
                            rec["status"] = status
                        rec["updated_at"] = datetime.now(timezone.utc)
                        return InMemoryRecord(rec)
                return None

            # chat_sessions UPDATE reset usage
            if "UPDATE CHAT_SESSIONS" in upper_q and "METADATA - 'USAGE'" in upper_q and len(args) >= 2:
                key = (str(args[0]), str(args[1]))
                rec = self._sessions.get(key)
                if rec:
                    if "usage" in rec.get("metadata", {}):
                        rec["metadata"].pop("usage", None)
                    rec["last_message_at"] = None
                    rec["updated_at"] = datetime.now(timezone.utc)
                    return InMemoryRecord({"session_id": rec["session_id"]})
                return None

            # Usage aggregation
            if "SUM" in upper_q and "PROMPT_TOKENS" in upper_q and len(args) >= 2:
                plat, conv = str(args[0]), str(args[1])
                p_tokens = 0
                c_tokens = 0
                for m in self._messages:
                    if m["platform"] == plat and m["conversation_id"] == conv:
                        usage = m["payload"].get("usage", {})
                        p_tokens += int(usage.get("prompt_tokens") or 0)
                        c_tokens += int(usage.get("completion_tokens") or 0)
                return InMemoryRecord({"prompt_tokens": p_tokens, "completion_tokens": c_tokens})

            return None

    async def fetch(self, query: str, *args: object) -> list[InMemoryRecord]:
        async with self._lock:
            upper_q = query.strip().upper()

            # chat_messages get_messages
            if "FROM CHAT_MESSAGES" in upper_q and len(args) >= 2:
                plat, conv = str(args[0]), str(args[1])
                limit = int(args[2]) if len(args) > 2 else 20
                matched = [
                    m for m in self._messages
                    if m["platform"] == plat and m["conversation_id"] == conv
                ]
                matched.sort(key=lambda m: m["created_at"], reverse=True)
                return [InMemoryRecord({"payload": m["payload"]}) for m in matched[:limit]]

            # User-scoped conversation turns and extracted facts remain separate.
            if (
                ("FROM CONVERSATION_MEMORIES" in upper_q
                 or "FROM EXTRACTED_MEMORIES" in upper_q)
                and len(args) >= 2
            ):
                plat, user_id = str(args[0]), str(args[1])
                now = datetime.now(timezone.utc)
                collection = self._facts if "EXTRACTED_MEMORIES" in upper_q else self._memories
                query_terms = {
                    term.casefold() for term in str(args[2]).split(" | ")
                } if len(args) > 2 else set()
                limit = int(args[3]) if len(args) > 3 else len(collection)
                matched: list[tuple[int, InMemoryRecord]] = []
                for item in collection:
                    if (
                        item["platform"] != plat
                        or item["user_id"] != user_id
                        or item.get("expires_at", now) <= now
                    ):
                        continue
                    content = str(item["content"])
                    score = sum(term in content.casefold() for term in query_terms)
                    if query_terms and score == 0:
                        continue
                    matched.append((score, InMemoryRecord({
                        "content": content,
                        "relevance": float(score),
                    })))
                matched.sort(key=lambda item: item[0], reverse=True)
                return [record for _, record in matched[:limit]]

            return []

    def _insert_memory(
        self,
        collection: list[InMemoryRecord],
        *,
        platform: str,
        user_id: str,
        content: str,
        retention_days: int,
        conversation_id: str = "",
    ) -> InMemoryRecord:
        expires_at = datetime.now(timezone.utc) + timedelta(days=retention_days)
        memory_id = self._memory_counter
        self._memory_counter += 1
        collection.append(InMemoryRecord({
            "memory_id": memory_id,
            "platform": platform,
            "user_id": user_id,
            "conversation_id": conversation_id,
            "content": content,
            "expires_at": expires_at,
        }))
        return InMemoryRecord({"memory_id": memory_id})


class DatabaseRouter:
    """Own the shared PostgreSQL pool and provide seamless in-memory fallback on connection failure."""

    def __init__(self, allow_fallback: bool = True) -> None:
        self._pool: Any = None
        self._lock = asyncio.Lock()
        self._is_fallback = False
        self._allow_fallback = allow_fallback

    @property
    def is_fallback(self) -> bool:
        """Return True if the database router is currently operating in in-memory fallback mode."""
        return self._is_fallback

    @property
    def pool(self) -> Any:
        if self._pool is None:
            raise RuntimeError("Database is not connected. Call initialize() first.")
        return self._pool

    def enable_fallback(self) -> None:
        """Explicitly switch the router to an in-memory fallback pool."""
        log.warning("DatabaseRouter: In-memory fallback mode activated.")
        self._pool = InMemoryDatabasePool()
        self._is_fallback = True

    def disable_fallback(self) -> None:
        """Reset the router so it attempts to connect to PostgreSQL again."""
        self._pool = None
        self._is_fallback = False

    async def connect(self) -> Any:
        if self._pool is not None:
            return self._pool

        async with self._lock:
            if self._pool is not None:
                return self._pool

            if self._is_fallback:
                self._pool = InMemoryDatabasePool()
                return self._pool

            password = os.environ.get("DB_PASSWORD")
            if not password:
                if self._allow_fallback:
                    log.warning("DB_PASSWORD is not set. Switching to in-memory database fallback.")
                    self.enable_fallback()
                    return self._pool
                raise RuntimeError("DB_PASSWORD is required to connect to PostgreSQL.")

            try:
                if asyncpg is None:
                    raise RuntimeError("asyncpg is not installed")
                self._pool = await asyncpg.create_pool(
                    host=os.environ.get("DB_HOST", "127.0.0.1"),
                    port=int(os.environ.get("DB_PORT", "5432")),
                    database=os.environ.get("DB_NAME", "zeus"),
                    user=os.environ.get("DB_USER", "zeus"),
                    password=password,
                    min_size=1,
                    max_size=int(os.environ.get("DB_POOL_MAX_SIZE", "10")),
                )
                self._is_fallback = False
                return self._pool
            except Exception as exc:
                if self._allow_fallback:
                    log.warning(
                        "PostgreSQL connection to %s:%s failed (%s). "
                        "Automatically falling back to in-memory database.",
                        os.environ.get("DB_HOST", "127.0.0.1"),
                        os.environ.get("DB_PORT", "5432"),
                        exc,
                    )
                    self.enable_fallback()
                    return self._pool
                raise

    async def initialize(self) -> None:
        pool = await self.connect()
        if self._is_fallback:
            log.info("Database initialized using in-memory fallback store.")
            return

        schema_path = Path(__file__).resolve().parent.parent / "database" / "schema.sql"
        try:
            schema = schema_path.read_text(encoding="utf-8")
            await pool.execute(schema)
        except Exception as exc:
            if self._allow_fallback:
                log.warning("Could not execute PostgreSQL schema (%s). Falling back to in-memory.", exc)
                self.enable_fallback()
                return
            raise RuntimeError(f"Could not read or execute shared schema at {schema_path}.") from exc

    async def close(self) -> None:
        async with self._lock:
            pool, self._pool = self._pool, None
            if pool is not None:
                await pool.close()

    async def fetch(self, query: str, *args: object) -> list[Any]:
        return await self.pool.fetch(query, *args)

    async def fetchrow(self, query: str, *args: object) -> Any | None:
        return await self.pool.fetchrow(query, *args)

    async def execute(self, query: str, *args: object) -> str:
        return await self.pool.execute(query, *args)

"""PostgreSQL store for background agent runs.

Provides atomic claim and persistence for agent runs, allowing them to survive
process restarts and be distributed across multiple worker processes.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from core.database import DatabaseRouter
from router.router import InferenceRequest, InferenceResponse

log = logging.getLogger(__name__)

@dataclass
class AgentRunRecord:
    run_id: str
    request: InferenceRequest
    status: str
    result: Optional[InferenceResponse] = None
    error: Optional[str] = None
    claimed_by: Optional[str] = None
    claimed_at: Optional[datetime] = None
    created_at: datetime = datetime.now(timezone.utc)
    updated_at: datetime = datetime.now(timezone.utc)

class AgentRunStore:
    """Durable storage for AgentRunner tasks in PostgreSQL."""

    def __init__(self, database: DatabaseRouter) -> None:
        self._db = database

    async def initialize(self) -> None:
        """Ensure the agent_runs table exists."""
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS agent_runs (
                run_id TEXT PRIMARY KEY,
                request JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
                result JSONB,
                error TEXT,
                claimed_by TEXT,
                claimed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_agent_runs_status_created ON agent_runs (status, created_at);
        """)

    async def create(self, request: InferenceRequest) -> str:
        """Create a new queued run."""
        run_id = uuid4().hex
        # We serialize InferenceRequest. To keep it simple, we extract the messages and params.
        req_payload = {
            "messages": [
                {"role": m.role, "content": m.content} for m in request.messages
            ],
            "model": request.model,
            "provider_name": request.provider_name,
            "platform": request.platform,
            "extra": request.extra,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
        await self._db.execute(
            "INSERT INTO agent_runs (run_id, request, status) VALUES ($1, $2::jsonb, 'queued')",
            run_id, json.dumps(req_payload)
        )
        return run_id

    async def claim_next(self, worker_id: str) -> Optional[AgentRunRecord]:
        """
        Atomically claim the oldest queued run.
        Uses FOR UPDATE SKIP LOCKED to support multiple workers.
        """
        # We use a transaction to ensure atomic claim.
        # Note: DatabaseRouter.pool.acquire() provides a connection.
        conn = await self._db.pool.acquire()
        try:
            async with conn.transaction():
                row = await conn.fetchrow("""
                    UPDATE agent_runs
                    SET status = 'running',
                        claimed_by = $1,
                        claimed_at = NOW(),
                        updated_at = NOW()
                    WHERE run_id = (
                        SELECT run_id FROM agent_runs
                        WHERE status = 'queued'
                        ORDER BY created_at ASC
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                    )
                    RETURNING run_id, request, status, result, error, claimed_by, claimed_at, created_at, updated_at
                """, worker_id)
                if not row:
                    return None
                return self._from_record(row)
        finally:
            await self._db.pool.release(conn)

    async def update_status(self, run_id: str, status: str, result: Optional[InferenceResponse] = None, error: Optional[str] = None) -> None:
        """Update run to a terminal or intermediate state."""
        res_payload = None
        if result:
            res_payload = {
                "content": result.content,
                "model": result.model,
                "provider": result.provider,
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "finish_reason": result.finish_reason,
                "thinking": result.thinking,
            }

        await self._db.execute(
            "UPDATE agent_runs SET status = $1, result = $2::jsonb, error = $3, updated_at = NOW() WHERE run_id = $4",
            status, json.dumps(res_payload) if res_payload else None, error, run_id
        )

    async def get_run(self, run_id: str) -> Optional[AgentRunRecord]:
        """Fetch a specific run by ID."""
        row = await self._db.fetchrow(
            "SELECT run_id, request, status, result, error, claimed_by, claimed_at, created_at, updated_at FROM agent_runs WHERE run_id = $1",
            run_id
        )
        return self._from_record(row) if row else None

    async def recover_stale_runs(self, timeout_seconds: float = 3600) -> int:
        """Return runs that have been 'running' for too long back to 'queued'."""
        # This is a simple recovery: if a run is running and has no update for X seconds, it's stale.
        count = await self._db.fetchrow(
            "UPDATE agent_runs SET status = 'queued', claimed_by = NULL, claimed_at = NULL WHERE status = 'running' AND updated_at < NOW() - make_interval(secs => $1) RETURNING count(*)",
            timeout_seconds
        )
        return count["count"] if count else 0

    async def prune_terminal_runs(self, limit: int = 100) -> None:
        """Deterministically prune the oldest terminal runs, keeping the most recent ones."""
        await self._db.execute("""
            DELETE FROM agent_runs
            WHERE run_id IN (
                SELECT run_id FROM agent_runs
                WHERE status IN ('completed', 'failed')
                ORDER BY updated_at DESC
                OFFSET $1
            )
        """, limit)

    def _from_record(self, row: Any) -> AgentRunRecord:
        # Reconstruct InferenceRequest from stored JSON
        req_data = row["request"]
        if isinstance(req_data, str):
            req_data = json.loads(req_data)
        
        # This is a simplification; in a real system we'd use a proper serializer.
        # We create a dummy InferenceRequest just to satisfy the type.
        from router.router import Message
        request = InferenceRequest(
            messages=[Message(role=m["role"], content=m["content"]) for m in req_data["messages"]],
            model=req_data.get("model"),
            provider_name=req_data.get("provider_name"),
            platform=req_data.get("platform"),
            extra=req_data.get("extra", {}),
            temperature=req_data.get("temperature"),
            max_tokens=req_data.get("max_tokens"),
        )

        return AgentRunRecord(
            run_id=row["run_id"],
            request=request,
            status=row["status"],
            result=None, # result reconstruction omitted for brevity in AgentRunRecord, usually we store raw JSON
            error=row["error"],
            claimed_by=row["claimed_by"],
            claimed_at=row["claimed_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

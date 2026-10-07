"""Async PostgreSQL access shared by Python services and platform adapters."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg


class DatabaseRouter:
    """Own the shared PostgreSQL pool and initialize the common schema."""

    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None
        self._lock = asyncio.Lock()

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("Database is not connected. Call initialize() first.")
        return self._pool

    async def connect(self) -> asyncpg.Pool:
        if self._pool is not None:
            return self._pool

        async with self._lock:
            if self._pool is not None:
                return self._pool

            password = os.environ.get("DB_PASSWORD")
            if not password:
                raise RuntimeError("DB_PASSWORD is required to connect to PostgreSQL.")

            self._pool = await asyncpg.create_pool(
                host=os.environ.get("DB_HOST", "127.0.0.1"),
                port=int(os.environ.get("DB_PORT", "5432")),
                database=os.environ.get("DB_NAME", "zeus"),
                user=os.environ.get("DB_USER", "zeus"),
                password=password,
                min_size=1,
                max_size=int(os.environ.get("DB_POOL_MAX_SIZE", "10")),
            )
            return self._pool

    async def initialize(self) -> None:
        pool = await self.connect()
        schema_path = Path(__file__).resolve().parent.parent / "database" / "schema.sql"
        try:
            schema = schema_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise RuntimeError(f"Could not read the shared database schema at {schema_path}.") from exc
        await pool.execute(schema)

    async def close(self) -> None:
        async with self._lock:
            pool, self._pool = self._pool, None
            if pool is not None:
                await pool.close()

    async def fetch(self, query: str, *args: object) -> list[asyncpg.Record]:
        return await self.pool.fetch(query, *args)

    async def fetchrow(self, query: str, *args: object) -> asyncpg.Record | None:
        return await self.pool.fetchrow(query, *args)

    async def execute(self, query: str, *args: object) -> str:
        return await self.pool.execute(query, *args)

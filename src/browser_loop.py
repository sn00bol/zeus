"""Own browser-session creation, reuse, eviction, and shutdown."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from typing import Protocol


class BrowserSession(Protocol):
    async def close(self) -> None: ...


class BrowserSessionFactory(Protocol):
    async def __call__(self, session_id: str) -> BrowserSession: ...


class BrowserLoop:
    """Keep agent-browser sessions bounded and close them with their owner."""

    def __init__(self, factory: BrowserSessionFactory, *, max_sessions: int = 4) -> None:
        if max_sessions < 1:
            raise ValueError("The browser session limit must be positive.")
        self._factory = factory
        self._max_sessions = max_sessions
        self._sessions: OrderedDict[str, BrowserSession] = OrderedDict()
        self._lock = asyncio.Lock()
        self._closing = False

    async def get(self, session_id: str) -> BrowserSession:
        if not session_id.strip():
            raise ValueError("A browser session ID is required.")
        async with self._lock:
            if self._closing:
                raise RuntimeError("The browser loop is shutting down.")
            session = self._sessions.get(session_id)
            if session is not None:
                self._sessions.move_to_end(session_id)
                return session
            if len(self._sessions) >= self._max_sessions:
                _, expired = self._sessions.popitem(last=False)
                await expired.close()
            session = await self._factory(session_id)
            self._sessions[session_id] = session
            return session

    async def close_session(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        await session.close()
        return True

    async def shutdown(self) -> None:
        async with self._lock:
            self._closing = True
            sessions = tuple(self._sessions.values())
            self._sessions.clear()
        results = await asyncio.gather(
            *(session.close() for session in sessions),
            return_exceptions=True,
        )
        errors = [result for result in results if isinstance(result, Exception)]
        if errors:
            raise RuntimeError(f"Could not close {len(errors)} browser session(s).") from errors[0]

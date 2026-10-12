"""Long-lived WebUI browser-session pool with bounded background health checks."""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from typing import Protocol

log = logging.getLogger(__name__)


class BrowserSession(Protocol):
    async def close(self) -> None: ...


class BrowserSessionFactory(Protocol):
    async def __call__(self, session_id: str) -> BrowserSession: ...


class BrowserLoop:
    """Own browser sessions and run a continuous lifecycle monitor for WebUI."""

    def __init__(
        self,
        factory: BrowserSessionFactory,
        *,
        max_sessions: int = 4,
        check_interval: float = 30,
        operation_timeout: float = 10,
    ) -> None:
        if max_sessions < 1:
            raise ValueError("The browser session limit must be positive.")
        if check_interval <= 0 or operation_timeout <= 0:
            raise ValueError("Browser lifecycle timeouts must be positive.")
        self._factory = factory
        self._max_sessions = max_sessions
        self._check_interval = check_interval
        self._operation_timeout = operation_timeout
        self._sessions: OrderedDict[str, BrowserSession] = OrderedDict()
        self._lock = asyncio.Lock()
        self._closing = False
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        async with self._lock:
            if self._closing:
                raise RuntimeError("The browser loop has already shut down.")
            if self.running:
                return
            self._task = asyncio.create_task(
                self._run(),
                name="webui-browser-loop",
            )

    async def get(self, session_id: str) -> BrowserSession:
        normalized_id = session_id.strip()
        if not normalized_id:
            raise ValueError("A browser session ID is required.")
        async with self._lock:
            if self._closing:
                raise RuntimeError("The browser loop is shutting down.")
            session = self._sessions.get(normalized_id)
            if session is not None:
                self._sessions.move_to_end(normalized_id)
                return session
            if len(self._sessions) >= self._max_sessions:
                _, expired = self._sessions.popitem(last=False)
                await self._close(expired)
            session = await asyncio.wait_for(
                self._factory(normalized_id),
                timeout=self._operation_timeout,
            )
            self._sessions[normalized_id] = session
            self._wake.set()
            return session

    async def close_session(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        await self._close(session)
        return True

    async def _run(self) -> None:
        try:
            while True:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), self._check_interval)
                    continue
                except TimeoutError:
                    pass
                try:
                    await self._check_sessions()
                except Exception:
                    log.exception("Browser session monitor iteration failed.")
        except asyncio.CancelledError:
            raise

    async def _check_sessions(self) -> None:
        async with self._lock:
            sessions = tuple(self._sessions.items())
        for session_id, session in sessions:
            is_alive = getattr(session, "is_alive", None)
            if is_alive is None:
                continue
            try:
                alive = await asyncio.wait_for(
                    is_alive(),
                    timeout=self._operation_timeout,
                )
            except Exception:
                log.exception("Browser session health check failed for %s.", session_id)
                alive = False
            if alive:
                continue
            async with self._lock:
                if self._sessions.get(session_id) is not session:
                    continue
                self._sessions.pop(session_id)
            await self._close(session)

    async def _close(self, session: BrowserSession) -> None:
        await asyncio.wait_for(session.close(), timeout=self._operation_timeout)

    async def shutdown(self) -> None:
        async with self._lock:
            self._closing = True
            task, self._task = self._task, None
            sessions = tuple(self._sessions.values())
            self._sessions.clear()
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        results = await asyncio.gather(
            *(self._close(session) for session in sessions),
            return_exceptions=True,
        )
        errors = [result for result in results if isinstance(result, Exception)]
        if errors:
            raise RuntimeError(f"Could not close {len(errors)} browser session(s).") from errors[0]

"""
router/broker — Lightweight in-memory event broker for real-time pub-sub communication.

Facilitates decoupled, event-driven messaging between core/, router/, webui,
and platform bridges (Discord, Telegram, tools).
"""

from __future__ import annotations

import asyncio
import fnmatch
import inspect
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable
from uuid import uuid4

log = logging.getLogger(__name__)

EventHandler = Callable[["Event"], Any | Awaitable[Any]]


@dataclass(frozen=True)
class Event:
    """An immutable event record published to the broker."""
    topic: str
    data: dict[str, Any] = field(default_factory=dict)
    event_id: str = field(default_factory=lambda: uuid4().hex)
    timestamp: float = field(default_factory=time.time)


class EventBroker:
    """
    Lightweight, asynchronous topic-based event broker.

    Supports wildcard patterns (e.g. 'inference.*', 'health.*', '*') and
    both callback subscribers and asynchronous queues.
    """

    def __init__(self, history_limit: int = 200) -> None:
        self._history_limit = max(10, history_limit)
        self._subscribers: dict[str, tuple[str, EventHandler]] = {}
        self._queues: dict[str, tuple[str, asyncio.Queue[Event]]] = {}
        self._history: list[Event] = []
        self._lock = asyncio.Lock()

    def subscribe(self, pattern: str, handler: EventHandler) -> str:
        """Subscribe a callback handler to topics matching *pattern*."""
        sub_id = uuid4().hex
        self._subscribers[sub_id] = (pattern, handler)
        return sub_id

    def unsubscribe(self, sub_id: str) -> bool:
        """Remove a subscription by its ID."""
        removed = self._subscribers.pop(sub_id, None) is not None
        self._queues.pop(sub_id, None)
        return removed

    def create_queue(self, pattern: str = "*", maxsize: int = 100) -> tuple[str, asyncio.Queue[Event]]:
        """Create a dedicated asyncio.Queue that receives events matching *pattern*."""
        sub_id = uuid4().hex
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=maxsize)
        self._queues[sub_id] = (pattern, queue)
        return sub_id, queue

    async def publish(self, topic: str, data: dict[str, Any] | None = None) -> Event:
        """
        Publish an event to *topic* and notify all matching subscribers.
        """
        event = Event(topic=topic, data=data or {})

        # Record history
        self._history.append(event)
        if len(self._history) > self._history_limit:
            self._history.pop(0)

        # Notify callbacks
        for _, (pattern, handler) in list(self._subscribers.items()):
            if fnmatch.fnmatch(topic, pattern):
                try:
                    res = handler(event)
                    if inspect.isawaitable(res):
                        asyncio.create_task(self._safe_await(res, topic))
                except Exception:
                    log.exception("Error in event handler for topic '%s'", topic)

        # Push to queues
        for _, (pattern, queue) in list(self._queues.items()):
            if fnmatch.fnmatch(topic, pattern):
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    # Drop oldest if full
                    try:
                        queue.get_nowait()
                        queue.put_nowait(event)
                    except Exception:
                        pass

        return event

    @staticmethod
    async def _safe_await(awaitable: Awaitable[Any], topic: str) -> None:
        try:
            await awaitable
        except Exception:
            log.exception("Error in async event handler for topic '%s'", topic)

    async def wait_for(
        self,
        pattern: str,
        timeout: float | None = None,
        predicate: Callable[[Event], bool] | None = None,
    ) -> Event:
        """
        Wait asynchronously for the next event matching *pattern* (and optional predicate).
        """
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Event] = loop.create_future()

        def _on_event(event: Event) -> None:
            if future.done():
                return
            if predicate is None or predicate(event):
                future.set_result(event)

        sub_id = self.subscribe(pattern, _on_event)
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self.unsubscribe(sub_id)

    def history(self, pattern: str | None = None, limit: int = 50) -> list[Event]:
        """Return the most recent events, optionally filtered by *pattern*."""
        if pattern is None or pattern == "*":
            return list(self._history[-limit:])
        filtered = [e for e in self._history if fnmatch.fnmatch(e.topic, pattern)]
        return filtered[-limit:]

    def clear(self) -> None:
        """Reset subscribers and history."""
        self._subscribers.clear()
        self._queues.clear()
        self._history.clear()


# Default singleton instance for easy import
_default_broker: EventBroker | None = None


def get_event_broker() -> EventBroker:
    """Return the global shared EventBroker instance."""
    global _default_broker
    if _default_broker is None:
        _default_broker = EventBroker()
    return _default_broker

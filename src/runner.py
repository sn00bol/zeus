"""Background stream execution with bounded, replayable per-run event buffers."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, AsyncIterator
from uuid import uuid4

log = logging.getLogger(__name__)

StreamWork = Callable[[Callable[[str, dict[str, Any]], None]], Awaitable[None]]


@dataclass(frozen=True)
class StreamEvent:
    event_id: int
    event: str
    data: dict[str, Any]
    size: int


@dataclass
class _Stream:
    session_id: str
    events: deque[StreamEvent] = field(default_factory=deque)
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    next_event_id: int = 1
    buffered_bytes: int = 0
    completed_at: float | None = None
    task: asyncio.Task[None] | None = None


class StreamCapacityError(RuntimeError):
    """Raised when all stream slots are occupied by live work."""


class StreamNotFoundError(KeyError):
    """Raised when a stream ID is unknown or its replay window expired."""


class StreamRunner:
    """Own inference tasks independently of connected SSE subscribers."""

    def __init__(
        self,
        *,
        max_streams: int = 32,
        max_events_per_stream: int = 8_192,
        max_buffer_bytes_per_stream: int = 2 * 1024 * 1024,
        ttl_seconds: float = 1800,
    ) -> None:
        if max_streams < 1 or max_events_per_stream < 1 or max_buffer_bytes_per_stream < 1:
            raise ValueError("Stream limits must be positive.")
        if ttl_seconds <= 0:
            raise ValueError("Stream TTL must be positive.")
        self.max_streams = max_streams
        self.max_events_per_stream = max_events_per_stream
        self.max_buffer_bytes_per_stream = max_buffer_bytes_per_stream
        self.ttl_seconds = ttl_seconds
        self._streams: dict[str, _Stream] = {}
        self._closed = False

    def start(self, session_id: str, work: StreamWork) -> str:
        if self._closed:
            raise RuntimeError("The stream runner is shutting down.")
        self.prune()
        if len(self._streams) >= self.max_streams:
            completed = [
                (stream_id, stream)
                for stream_id, stream in self._streams.items()
                if stream.completed_at is not None
            ]
            if not completed:
                raise StreamCapacityError(
                    "The WebUI is handling too many chat streams. Try again shortly."
                )
            oldest_id, _ = min(completed, key=lambda item: item[1].completed_at or 0)
            del self._streams[oldest_id]

        stream_id = str(uuid4())
        stream = _Stream(session_id=session_id)
        self._streams[stream_id] = stream
        self._publish(stream, "ui_control", {"state": "started"})
        stream.task = asyncio.create_task(
            self._drain(stream, work),
            name=f"webui-stream-{stream_id}",
        )
        return stream_id

    async def _drain(self, stream: _Stream, work: StreamWork) -> None:
        def publish(event: str, data: dict[str, Any]) -> None:
            self._publish(stream, event, data)

        try:
            await work(publish)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.exception("Background WebUI stream for session %s failed.", stream.session_id)
            message = str(exc)[:1_000] or "The model request failed."
            publish("ui_control", {"state": "error", "message": message})
            publish("stream_error", {"message": message})
        finally:
            stream.completed_at = time.monotonic()
            stream.changed.set()

    def _publish(self, stream: _Stream, event: str, data: dict[str, Any]) -> None:
        encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > self.max_buffer_bytes_per_stream:
            raise ValueError("A stream event exceeds the configured replay buffer limit.")
        item = StreamEvent(stream.next_event_id, event, data, len(encoded))
        stream.next_event_id += 1
        stream.events.append(item)
        stream.buffered_bytes += item.size
        while (
            len(stream.events) > self.max_events_per_stream
            or stream.buffered_bytes > self.max_buffer_bytes_per_stream
        ):
            removed = stream.events.popleft()
            stream.buffered_bytes -= removed.size
        stream.changed.set()

    def has(self, stream_id: str) -> bool:
        self.prune()
        return stream_id in self._streams

    def active_for_session(self, session_id: str) -> str | None:
        self.prune()
        return next(
            (
                stream_id
                for stream_id, stream in reversed(tuple(self._streams.items()))
                if stream.session_id == session_id and stream.completed_at is None
            ),
            None,
        )

    def events(
        self,
        stream_id: str,
        *,
        after_event_id: int = 0,
    ) -> AsyncIterator[StreamEvent]:
        self.prune()
        stream = self._streams.get(stream_id)
        if stream is None:
            raise StreamNotFoundError(stream_id)
        return self._iterate_events(stream, after_event_id)

    async def _iterate_events(
        self,
        stream: _Stream,
        after_event_id: int,
    ) -> AsyncIterator[StreamEvent]:
        cursor = after_event_id
        while True:
            item = next((event for event in stream.events if event.event_id > cursor), None)
            if item is None:
                if stream.completed_at is not None:
                    return
                stream.changed.clear()
                await stream.changed.wait()
                continue
            cursor = item.event_id
            yield item
            if item.event in {"done", "stream_error"}:
                return

    async def stop(self) -> None:
        self._closed = True
        tasks = [
            stream.task for stream in self._streams.values()
            if stream.task is not None and not stream.task.done()
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def prune(self, now: float | None = None) -> None:
        current = time.monotonic() if now is None else now
        expired = [
            stream_id for stream_id, stream in self._streams.items()
            if stream.completed_at is not None
            and current - stream.completed_at >= self.ttl_seconds
        ]
        for stream_id in expired:
            del self._streams[stream_id]

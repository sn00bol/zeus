"""Bounded orchestration for concurrent, long-running model responses."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable

from router.router import InferenceRequest, InferenceResponse, Router


class ModelLoop:
    """Apply backpressure to model calls while delegating state to the Router."""

    def __init__(self, router: Router, *, max_concurrent: int | None = None) -> None:
        configured = (
            int(os.environ.get("WEBUI_MAX_MODEL_RUNS", "4"))
            if max_concurrent is None else max_concurrent
        )
        if configured < 1:
            raise ValueError("The model concurrency limit must be positive.")
        self._router = router
        self._slots = asyncio.Semaphore(configured)
        self._closing = False

    async def respond(
        self,
        request: InferenceRequest,
        on_delta: Callable[[str], Awaitable[None]],
    ) -> InferenceResponse:
        if self._closing:
            raise RuntimeError("The model loop is shutting down.")
        async with self._slots:
            if self._closing:
                raise RuntimeError("The model loop is shutting down.")
            return await self._router.route_stream(request, on_delta)

    def close(self) -> None:
        self._closing = True

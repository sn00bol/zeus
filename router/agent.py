"""Background agent-run queue and worker loop."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from uuid import uuid4

from router.router import InferenceRequest, InferenceResponse, Router

log = logging.getLogger(__name__)


@dataclass
class AgentRun:
    run_id: str
    request: InferenceRequest
    status: str = "queued"
    result: InferenceResponse | None = None
    error: str | None = None


class AgentQueueFull(Exception):
    """Raised when the bounded background queue cannot accept another run."""


class AgentRunner:
    """Accept agent runs and process them continuously on a background worker."""

    def __init__(self, router: Router, max_queue_size: int = 100) -> None:
        self._router = router
        self._queue: asyncio.Queue[AgentRun] = asyncio.Queue(maxsize=max_queue_size)
        self._runs: dict[str, AgentRun] = {}
        self._worker: asyncio.Task[None] | None = None
        self._current: AgentRun | None = None

    async def start(self) -> None:
        if self._worker is None:
            self._worker = asyncio.create_task(self._run_loop(), name="agent-runner")

    async def stop(self) -> None:
        if self._worker is None:
            return

        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        self._worker = None

        if self._current is not None:
            self._current.status = "failed"
            self._current.error = "Agent runner stopped before the run completed."
            self._current = None

        while not self._queue.empty():
            run = self._queue.get_nowait()
            run.status = "failed"
            run.error = "Agent runner stopped before the run started."
            self._queue.task_done()

    def submit(self, request: InferenceRequest) -> AgentRun:
        if self._worker is None:
            raise RuntimeError("Agent runner is not started.")
        run = AgentRun(run_id=uuid4().hex, request=request)
        try:
            self._queue.put_nowait(run)
        except asyncio.QueueFull as exc:
            raise AgentQueueFull("The agent run queue is full. Try again shortly.") from exc
        self._runs[run.run_id] = run
        self._prune_completed_runs()
        return run

    def get(self, run_id: str) -> AgentRun | None:
        return self._runs.get(run_id)

    def status(self) -> dict[str, object]:
        completed = next(
            (run for run in reversed(tuple(self._runs.values()))
             if run.status == "completed" and run.result is not None),
            None,
        )
        return {
            "queue_depth": self._queue.qsize(),
            "queue_capacity": self._queue.maxsize,
            "collecting": self._current is not None,
            "last_result": self._result_payload(completed.result) if completed else None,
        }

    @staticmethod
    def _result_payload(result: InferenceResponse) -> dict[str, object]:
        return {
            "model": result.model,
            "provider": result.provider,
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
        }

    async def _run_loop(self) -> None:
        while True:
            run = await self._queue.get()
            self._current = run
            run.status = "running"
            try:
                run.result = await self._router.route(run.request)
                run.status = "completed"
            except asyncio.CancelledError:
                run.status = "failed"
                run.error = "Agent runner stopped before the run completed."
                raise
            except Exception as exc:
                log.exception("Agent run %s failed", run.run_id)
                run.status = "failed"
                run.error = str(exc)
            finally:
                self._current = None
                self._queue.task_done()

    def _prune_completed_runs(self) -> None:
        completed = [
            run_id for run_id, run in self._runs.items()
            if run.status in {"completed", "failed"}
        ]
        while len(self._runs) > 100 and completed:
            del self._runs[completed.pop(0)]

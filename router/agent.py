"""Background agent-run queue and worker loop."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any
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
    """Accept agent runs and process them continuously on a background worker pool."""

    def __init__(self, router: Router, store: Any, max_queue_size: int = 100) -> None:
        self._router = router
        self._store = store
        self._max_queue_size = max_queue_size
        self._runs: dict[str, AgentRun] = {}
        self._workers: list[asyncio.Task[None]] = []
        self._current_runs: dict[str, AgentRun] = {}

    async def start(self, worker_count: int | None = None) -> None:
        """Start the worker pool. Resolves worker count from env or hardware defaults."""
        if self._workers:
            return

        # Auto worker count: Conservative default 2, or numeric env override
        if worker_count is None:
            import os
            env_val = os.environ.get("AGENT_WORKERS")
            try:
                worker_count = int(env_val) if env_val else 2
            except ValueError:
                worker_count = 2
        
        log.info("Starting AgentRunner worker pool with %d workers", worker_count)
        for i in range(worker_count):
            task = asyncio.create_task(self._run_loop(), name=f"agent-worker-{i}")
            self._workers.append(task)

    async def stop(self) -> None:
        """Gracefully stop workers. Cancel tasks and mark current runs as failed."""
        if not self._workers:
            return

        for worker in self._workers:
            worker.cancel()
        
        try:
            await asyncio.gather(*self._workers, return_exceptions=True)
        finally:
            self._workers.clear()

        for run_id, run in self._current_runs.items():
            run.status = "failed"
            run.error = "Agent runner stopped before the run completed."
            await self._store.update_status(run_id, "failed", error=run.error)
        self._current_runs.clear()

    async def submit(self, request: InferenceRequest) -> AgentRun:
        """Persist a new run to the store and return the record."""
        request.extra.setdefault("think", True)
        run_id = await self._store.create(request)
        
        # Construct local AgentRun object for the caller
        run = AgentRun(run_id=run_id, request=request)
        self._runs[run_id] = run
        self._prune_completed_runs()

        # Emit broker event if broker is available
        broker = getattr(self._router, "broker", None)
        if broker is not None:
            asyncio.create_task(broker.publish("agent.queued", {"run_id": run_id, "platform": request.platform}))

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
            "queue_depth": "Durable (Postgres)",
            "queue_capacity": self._max_queue_size,
            "collecting": len(self._current_runs) > 0,
            "active_workers": len(self._workers),
            "last_result": self._result_payload(completed.result) if completed else None,
        }

    @staticmethod
    def _result_payload(result: InferenceResponse) -> dict[str, object]:
        return {
            "model": result.model,
            "provider": result.provider,
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "thinking": result.thinking,
        }

    async def _run_loop(self) -> None:
        """Continuous worker loop that claims and executes runs from the durable store."""
        worker_id = f"worker-{uuid4().hex[:8]}"
        broker = getattr(self._router, "broker", None)
        
        while True:
            try:
                # 1. Claim a job from the durable store
                record = await self._store.claim_next(worker_id)
                if record is None:
                    # No work available; wait before polling again
                    await asyncio.sleep(1.0)
                    continue

                # Wrap record into a local AgentRun object
                run = AgentRun(
                    run_id=record.run_id,
                    request=record.request,
                    status="running",
                    error=record.error
                )
                self._current_runs[run.run_id] = run
                self._runs[run.run_id] = run

                if broker is not None:
                    try:
                        await broker.publish("agent.started", {"run_id": run.run_id})
                    except Exception:
                        log.exception("Broker publish failed for agent.started")

                try:
                    # Execute the inference
                    run.result = await self._router.route(run.request)
                    run.status = "completed"
                    await self._store.update_status(run.run_id, "completed", result=run.result)
                    
                    if broker is not None:
                        try:
                            await broker.publish(
                                "agent.completed",
                                {
                                    "run_id": run.run_id,
                                    "model": run.result.model,
                                    "provider": run.result.provider,
                                },
                            )
                        except Exception:
                            log.exception("Broker publish failed for agent.completed")

                except asyncio.CancelledError:
                    run.status = "failed"
                    run.error = "Worker cancelled during execution."
                    await self._store.update_status(run.run_id, "failed", error=run.error)
                    if broker is not None:
                        try:
                            await broker.publish("agent.failed", {"run_id": run.run_id, "error": run.error})
                        except Exception:
                            log.exception("Broker publish failed for agent.failed")
                    raise

                except Exception as exc:
                    log.exception("Agent run %s failed", run.run_id)
                    run.status = "failed"
                    run.error = str(exc)
                    await self._store.update_status(run.run_id, "failed", error=run.error)
                    if broker is not None:
                        try:
                            await broker.publish("agent.failed", {"run_id": run.run_id, "error": run.error})
                        except Exception:
                            log.exception("Broker publish failed for agent.failed")

                finally:
                    self._current_runs.pop(run.run_id, None)
                    self._prune_completed_runs()

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.exception("Unexpected error in worker loop %s", worker_id)
                await asyncio.sleep(1.0)

    def _prune_completed_runs(self) -> None:
        completed = [
            run_id for run_id, run in self._runs.items()
            if run.status in {"completed", "failed"}
        ]
        while len(self._runs) > 100 and completed:
            del self._runs[completed.pop(0)]

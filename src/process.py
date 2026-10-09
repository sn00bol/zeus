"""Bounded lifecycle management for external agent processes."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ManagedProcess:
    key: str
    process: asyncio.subprocess.Process


class ProcessSupervisor:
    def __init__(self, *, terminate_timeout: float = 5) -> None:
        if terminate_timeout <= 0:
            raise ValueError("Process termination timeout must be positive.")
        self._terminate_timeout = terminate_timeout
        self._processes: dict[str, ManagedProcess] = {}
        self._lock = asyncio.Lock()

    async def start(
        self,
        key: str,
        command: list[str],
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
    ) -> ManagedProcess:
        if not key.strip() or not command or not command[0]:
            raise ValueError("A process key and executable command are required.")
        async with self._lock:
            previous = self._processes.get(key)
            if previous is not None and previous.process.returncode is None:
                raise RuntimeError(f"Process {key!r} is already running.")
            environment = os.environ.copy()
            if env:
                environment.update(env)
            child = await asyncio.create_subprocess_exec(
                *command,
                cwd=str(cwd) if cwd is not None else None,
                env=environment,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            managed = ManagedProcess(key=key, process=child)
            self._processes[key] = managed
            return managed

    async def stop(self, key: str) -> None:
        async with self._lock:
            managed = self._processes.pop(key, None)
        if managed is not None:
            await self._terminate(managed.process)

    async def stop_all(self) -> None:
        async with self._lock:
            processes = tuple(self._processes.values())
            self._processes.clear()
        results = await asyncio.gather(
            *(self._terminate(item.process) for item in processes),
            return_exceptions=True,
        )
        errors = [result for result in results if isinstance(result, Exception)]
        if errors:
            raise RuntimeError(
                f"Could not stop {len(errors)} managed process(es)."
            ) from errors[0]

    async def _terminate(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        try:
            process.terminate()
        except ProcessLookupError:
            await process.wait()
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=self._terminate_timeout)
        except asyncio.TimeoutError:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()

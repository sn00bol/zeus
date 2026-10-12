"""Generic subprocess identity, signalling, verified shutdown, and reconciliation."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import uuid4

log = logging.getLogger(__name__)

ProcessSignal = Literal["interrupt", "terminate", "kill"]


@dataclass(frozen=True)
class ProcessIdentity:
    pid: int
    start_token: str | None
    executable: str
    command_fingerprint: str


@dataclass
class ManagedProcess:
    key: str
    process: asyncio.subprocess.Process
    identity: ProcessIdentity

    @property
    def pid(self) -> int:
        return self.identity.pid

    @property
    def returncode(self) -> int | None:
        return self.process.returncode

    @property
    def is_alive(self) -> bool:
        return self.process.returncode is None


@dataclass(frozen=True)
class ReconciliationReport:
    terminated: tuple[int, ...] = ()
    already_exited: tuple[int, ...] = ()
    unverifiable: tuple[int, ...] = ()


class ProcessSupervisor:
    """Owns child processes and a durable manifest for safe restart recovery."""

    def __init__(
        self,
        *,
        terminate_timeout: float = 5,
        kill_timeout: float = 3,
        registry_path: Path | None = None,
        namespace: str = "zeus",
    ) -> None:
        if terminate_timeout <= 0 or kill_timeout <= 0:
            raise ValueError("Process shutdown timeouts must be positive.")
        if not namespace.strip():
            raise ValueError("A process supervisor namespace is required.")
        self._terminate_timeout = terminate_timeout
        self._kill_timeout = kill_timeout
        self._registry_path = registry_path
        self._namespace = namespace.strip()
        self._instance_id = str(uuid4())
        self._processes: dict[str, ManagedProcess] = {}
        self._lock = asyncio.Lock()
        self._initialization_lock = asyncio.Lock()
        self._initialized = False

    async def initialize(self) -> ReconciliationReport:
        """Reconcile a previous process registry before this instance starts work."""
        async with self._initialization_lock:
            if self._initialized:
                return ReconciliationReport()
            report = await self.reconcile()
            self._initialized = True
            return report

    async def start(
        self,
        key: str,
        command: list[str],
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
    ) -> ManagedProcess:
        normalized_key = key.strip()
        if not normalized_key or not command or not command[0]:
            raise ValueError("A process key and executable command are required.")
        await self.initialize()
        async with self._lock:
            previous = self._processes.get(normalized_key)
            if previous is not None and await self.is_alive(previous):
                raise RuntimeError(f"Process {normalized_key!r} is already running.")
            environment = os.environ.copy()
            if env:
                environment.update(env)
            kwargs: dict[str, object] = {
                "cwd": str(cwd) if cwd is not None else None,
                "env": environment,
                "stdin": asyncio.subprocess.DEVNULL,
                "stdout": asyncio.subprocess.DEVNULL,
                "stderr": asyncio.subprocess.DEVNULL,
            }
            if os.name == "nt":
                kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                kwargs["start_new_session"] = True
            child = await asyncio.create_subprocess_exec(*command, **kwargs)
            executable = _resolved_executable(command[0])
            identity = ProcessIdentity(
                pid=child.pid,
                start_token=_process_token(child.pid),
                executable=executable,
                command_fingerprint=_command_fingerprint(command),
            )
            managed = ManagedProcess(normalized_key, child, identity)
            self._processes[normalized_key] = managed
            try:
                self._write_registry()
            except Exception:
                await self._terminate(managed)
                self._processes.pop(normalized_key, None)
                raise
            return managed

    async def is_alive(self, process: ManagedProcess | str) -> bool:
        managed = self._processes.get(process.strip()) if isinstance(process, str) else process
        if managed is None:
            return False
        if managed.process.returncode is not None:
            return False
        try:
            return _identity_matches(managed.identity)
        except PermissionError:
            return True

    async def signal(self, key: str, requested: ProcessSignal) -> bool:
        if requested not in {"interrupt", "terminate", "kill"}:
            raise ValueError(f"Unsupported process signal: {requested!r}.")
        managed = self._processes.get(key.strip())
        if managed is None or not await self.is_alive(managed):
            return False
        _signal_managed(managed, requested)
        return True

    async def wait(
        self,
        key: str,
        *,
        timeout: float | None = None,
    ) -> int:
        if timeout is not None and timeout <= 0:
            raise ValueError("Process wait timeout must be positive.")
        managed = self._processes.get(key.strip())
        if managed is None:
            raise KeyError(key)
        waiter = managed.process.wait()
        returncode = (
            await asyncio.wait_for(waiter, timeout)
            if timeout is not None
            else await waiter
        )
        if await self.is_alive(managed):
            raise RuntimeError(f"Process {key!r} did not reach verified death.")
        return returncode

    async def stop(self, key: str) -> None:
        key = key.strip()
        async with self._lock:
            managed = self._processes.get(key)
        if managed is None:
            return
        await self._terminate(managed)
        async with self._lock:
            if self._processes.get(key) is managed:
                self._processes.pop(key)
                self._write_registry()

    async def stop_all(self) -> None:
        async with self._lock:
            processes = tuple(self._processes.values())
        results = await asyncio.gather(
            *(self._terminate(item) for item in processes),
            return_exceptions=True,
        )
        errors = [result for result in results if isinstance(result, Exception)]
        async with self._lock:
            for item in processes:
                if self._processes.get(item.key) is item:
                    self._processes.pop(item.key)
            self._write_registry()
        if errors:
            raise RuntimeError(f"Could not stop {len(errors)} managed process(es).") from errors[0]

    async def reconcile(self, *, terminate_orphans: bool = True) -> ReconciliationReport:
        """Remove exited records and optionally stop verified children from an older run."""
        if self._registry_path is None or not self._registry_path.exists():
            return ReconciliationReport()
        records = self._read_registry()
        terminated: list[int] = []
        already_exited: list[int] = []
        unverifiable: list[int] = []
        retained: list[dict[str, object]] = []
        for record in records:
            if record.get("namespace") != self._namespace:
                retained.append(record)
                continue
            if record.get("instance_id") == self._instance_id:
                retained.append(record)
                continue
            identity = _identity_from_record(record)
            if identity is None:
                log.warning("Skipping malformed process reconciliation record.")
                continue
            if not _identity_matches(identity):
                if _pid_exists(identity.pid):
                    unverifiable.append(identity.pid)
                    retained.append(record)
                else:
                    already_exited.append(identity.pid)
                continue
            if not terminate_orphans:
                retained.append(record)
                continue
            try:
                await _terminate_orphan(identity, self._terminate_timeout, self._kill_timeout)
            except (OSError, ProcessLookupError, TimeoutError) as exc:
                log.warning(
                    "Could not reconcile orphan process %s (%s: %s).",
                    identity.pid,
                    type(exc).__name__,
                    exc,
                )
                retained.append(record)
                continue
            terminated.append(identity.pid)
        self._write_registry_records(retained)
        return ReconciliationReport(
            tuple(terminated),
            tuple(already_exited),
            tuple(unverifiable),
        )

    async def _terminate(self, managed: ManagedProcess) -> None:
        if not await self.is_alive(managed):
            await managed.process.wait()
            if await self.is_alive(managed):
                raise RuntimeError(f"Process {managed.key!r} could not be verified dead.")
            return
        _signal_managed(managed, "terminate")
        try:
            await asyncio.wait_for(
                managed.process.wait(),
                timeout=self._terminate_timeout,
            )
        except TimeoutError:
            _signal_managed(managed, "kill")
            try:
                await asyncio.wait_for(
                    managed.process.wait(),
                    timeout=self._kill_timeout,
                )
            except TimeoutError as exc:
                raise TimeoutError(
                    f"Process {managed.key!r} did not exit after terminate and kill."
                ) from exc
        if await self.is_alive(managed):
            raise RuntimeError(f"Process {managed.key!r} did not reach verified death.")
        await _ensure_process_group_dead(managed.pid, self._kill_timeout)

    def _read_registry(self) -> list[dict[str, object]]:
        try:
            contents = json.loads(self._registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Could not read process registry {self._registry_path}.") from exc
        if not isinstance(contents, list):
            raise ValueError(f"Process registry {self._registry_path} is malformed.")
        return [item for item in contents if isinstance(item, dict)]

    def _write_registry(self) -> None:
        if self._registry_path is None:
            return
        preserved = [
            record for record in self._read_registry()
            if record.get("namespace") != self._namespace
            or record.get("instance_id") != self._instance_id
        ] if self._registry_path.exists() else []
        current = [
            _record_for(self._namespace, self._instance_id, process)
            for process in self._processes.values()
        ]
        self._write_registry_records([*preserved, *current])

    def _write_registry_records(self, records: list[dict[str, object]]) -> None:
        if self._registry_path is None:
            return
        path = self._registry_path
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(records, separators=(",", ":")),
                encoding="utf-8",
            )
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def _resolved_executable(command: str) -> str:
    resolved = shutil.which(command) or command
    return str(Path(resolved).expanduser().resolve())


def _command_fingerprint(command: list[str]) -> str:
    return hashlib.sha256("\0".join(command).encode("utf-8")).hexdigest()


def _record_for(
    namespace: str,
    instance_id: str,
    process: ManagedProcess,
) -> dict[str, object]:
    return {
        "namespace": namespace,
        "instance_id": instance_id,
        "key": process.key,
        "pid": process.pid,
        "start_token": process.identity.start_token,
        "executable": process.identity.executable,
        "command_fingerprint": process.identity.command_fingerprint,
    }


def _identity_from_record(record: dict[str, object]) -> ProcessIdentity | None:
    pid = record.get("pid")
    start_token = record.get("start_token")
    executable = record.get("executable")
    fingerprint = record.get("command_fingerprint")
    if (
        not isinstance(pid, int)
        or not isinstance(executable, str)
        or not isinstance(fingerprint, str)
        or (start_token is not None and not isinstance(start_token, str))
    ):
        return None
    return ProcessIdentity(pid, start_token, executable, fingerprint)


def _pid_exists(pid: int) -> bool:
    if os.name == "nt":
        return _windows_process_token(pid) is not None
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _process_token(pid: int) -> str | None:
    if os.name == "nt":
        return _windows_process_token(pid)
    proc_stat = Path(f"/proc/{pid}/stat")
    if proc_stat.exists():
        try:
            fields = proc_stat.read_text(encoding="utf-8").rsplit(")", 1)[1].split()
            return fields[19]
        except (OSError, IndexError):
            return None
    return _portable_process_token(pid)


def _process_executable(pid: int) -> str | None:
    if os.name == "nt":
        return _windows_process_executable(pid)
    proc_exe = Path(f"/proc/{pid}/exe")
    if proc_exe.exists():
        try:
            return str(proc_exe.resolve())
        except OSError:
            return None
    return None


def _identity_matches(identity: ProcessIdentity) -> bool:
    token = _process_token(identity.pid)
    if token is None or identity.start_token is None or token != identity.start_token:
        return False
    executable = _process_executable(identity.pid)
    if executable is not None and os.path.normcase(executable) != os.path.normcase(
        identity.executable
    ):
        return False
    return True


def _portable_process_token(pid: int) -> str | None:
    try:
        result = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            capture_output=True,
            text=True,
            check=False,
            timeout=1,
        )
    except (OSError, TimeoutError):
        return None
    return result.stdout.strip() or None


def _windows_process_handle(pid: int) -> int | None:
    import ctypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong)
    kernel32.OpenProcess.restype = ctypes.c_void_p
    handle = kernel32.OpenProcess(0x1000, False, pid)
    return handle or None


def _windows_process_token(pid: int) -> str | None:
    import ctypes

    handle = _windows_process_handle(pid)
    if handle is None:
        return None
    try:
        creation = ctypes.c_ulonglong()
        exit_time = ctypes.c_ulonglong()
        kernel_time = ctypes.c_ulonglong()
        user_time = ctypes.c_ulonglong()
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetProcessTimes.argtypes = (
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_ulonglong),
            ctypes.POINTER(ctypes.c_ulonglong),
            ctypes.POINTER(ctypes.c_ulonglong),
            ctypes.POINTER(ctypes.c_ulonglong),
        )
        kernel32.GetProcessTimes.restype = ctypes.c_int
        if not kernel32.GetProcessTimes(
            handle,
            ctypes.byref(creation),
            ctypes.byref(exit_time),
            ctypes.byref(kernel_time),
            ctypes.byref(user_time),
        ):
            return None
        exit_code = ctypes.c_ulong()
        kernel32.GetExitCodeProcess.argtypes = (
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_ulong),
        )
        kernel32.GetExitCodeProcess.restype = ctypes.c_int
        if (
            not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
            or exit_code.value != 259
        ):
            return None
        return str(creation.value)
    finally:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        kernel32.CloseHandle.restype = ctypes.c_int
        kernel32.CloseHandle(ctypes.c_void_p(handle))


def _windows_process_executable(pid: int) -> str | None:
    import ctypes
    from ctypes import wintypes

    handle = _windows_process_handle(pid)
    if handle is None:
        return None
    try:
        buffer = ctypes.create_unicode_buffer(32_768)
        length = wintypes.DWORD(len(buffer))
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.QueryFullProcessImageNameW.argtypes = (
            ctypes.c_void_p,
            wintypes.DWORD,
            wintypes.LPWSTR,
            ctypes.POINTER(wintypes.DWORD),
        )
        kernel32.QueryFullProcessImageNameW.restype = ctypes.c_int
        if not kernel32.QueryFullProcessImageNameW(
            handle,
            0,
            buffer,
            ctypes.byref(length),
        ):
            return None
        return buffer.value
    finally:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        kernel32.CloseHandle.restype = ctypes.c_int
        kernel32.CloseHandle(ctypes.c_void_p(handle))


def _signal_managed(managed: ManagedProcess, requested: ProcessSignal) -> None:
    if os.name == "nt":
        if requested == "interrupt":
            managed.process.send_signal(signal.CTRL_BREAK_EVENT)
        elif requested == "terminate":
            _windows_kill_tree(managed.pid, force=False)
        else:
            _windows_kill_tree(managed.pid)
        return
    requested_signal = {
        "interrupt": signal.SIGINT,
        "terminate": signal.SIGTERM,
        "kill": signal.SIGKILL,
    }[requested]
    try:
        os.killpg(managed.pid, requested_signal)
    except ProcessLookupError:
        pass


def _windows_kill_tree(pid: int, *, force: bool = True) -> None:
    command = ["taskkill", "/PID", str(pid), "/T"]
    if force:
        command.append("/F")
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )
    if result.returncode != 0 and _pid_exists(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError as exc:
            raise OSError(
                result.stderr.strip() or f"taskkill failed for process {pid}."
            ) from exc


async def _terminate_orphan(
    identity: ProcessIdentity,
    terminate_timeout: float,
    kill_timeout: float,
) -> None:
    if not _identity_matches(identity) and not _process_group_exists(identity.pid):
        raise ProcessLookupError(identity.pid)
    if os.name == "nt":
        if _identity_matches(identity):
            _windows_kill_tree(identity.pid)
    else:
        os.killpg(identity.pid, signal.SIGTERM)
    deadline = time.monotonic() + terminate_timeout
    while time.monotonic() < deadline:
        if not _identity_matches(identity) and not _process_group_exists(identity.pid):
            return
        await asyncio.sleep(0.05)
    if os.name == "nt":
        _windows_kill_tree(identity.pid)
    else:
        try:
            os.killpg(identity.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
    deadline = time.monotonic() + kill_timeout
    while time.monotonic() < deadline:
        if not _identity_matches(identity) and not _process_group_exists(identity.pid):
            return
        await asyncio.sleep(0.05)
    raise TimeoutError(f"Orphan process {identity.pid} did not exit.")


def _process_group_exists(group_id: int) -> bool:
    if os.name == "nt":
        return False
    try:
        os.killpg(group_id, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


async def _ensure_process_group_dead(group_id: int, timeout: float) -> None:
    if os.name == "nt" or not _process_group_exists(group_id):
        return
    try:
        os.killpg(group_id, signal.SIGKILL)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _process_group_exists(group_id):
            return
        await asyncio.sleep(0.05)
    raise TimeoutError(f"Process group {group_id} did not exit.")

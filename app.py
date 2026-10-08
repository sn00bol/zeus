"""Start the configured ZEUS platform and its required services."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import TextIO
from urllib.error import URLError
from urllib.request import urlopen

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

_BRIDGE_STARTUP_MARKERS = (
    "Started server process [",
    "Waiting for application startup.",
    "Application startup complete.",
    "Uvicorn running on http://",
)


def _is_visible_bridge_startup_log(line: str) -> bool:
    return (
        any(marker in line for marker in _BRIDGE_STARTUP_MARKERS)
        or ("/health HTTP/" in line and " 200" in line)
    )


class _RunLogRecorder:
    def __init__(self, logs_dir: Path = ROOT / "logs") -> None:
        logs_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        self._temporary_path = logs_dir / f"zeus-{stamp}.log.tmp"
        self._final_path = logs_dir / f"zeus-{stamp}.log"
        self._stream = self._temporary_path.open("w", encoding="utf-8", newline="")
        self._lock = threading.Lock()
        self._threads: list[threading.Thread] = []
        self.health_log_received = threading.Event()

    def record(self, message: str) -> None:
        with self._lock:
            self._stream.write(f"[supervisor] {message}\n")
            self._stream.flush()

    def attach(self, name: str, stream: TextIO, *, show_startup: bool = False) -> None:
        def capture() -> None:
            try:
                for line in stream:
                    with self._lock:
                        self._stream.write(f"[{name}] {line}")
                        self._stream.flush()
                    if show_startup and _is_visible_bridge_startup_log(line):
                        print(line, end="", flush=True)
                    if show_startup and "/health HTTP/" in line and " 200" in line:
                        self.health_log_received.set()
            finally:
                stream.close()

        thread = threading.Thread(target=capture, name=f"zeus-log-{name}", daemon=True)
        thread.start()
        self._threads.append(thread)

    def finish(self) -> Path:
        for thread in self._threads:
            thread.join()
        with self._lock:
            self._stream.close()
        self._temporary_path.replace(self._final_path)
        return self._final_path


def _stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def _wait_for_bridge(process: subprocess.Popen[str], port: int, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    health_url = f"http://127.0.0.1:{port}/health"
    while time.monotonic() < deadline:
        exit_code = process.poll()
        if exit_code is not None:
            raise RuntimeError(f"The inference bridge exited during startup (code {exit_code}).")
        try:
            with urlopen(health_url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, URLError):
            time.sleep(0.25)
    raise RuntimeError(f"The inference bridge did not become ready at {health_url}.")


def _poll_control(port: int) -> str | None:
    control_url = f"http://127.0.0.1:{port}/control/next"
    try:
        with urlopen(control_url, timeout=0.5) as response:
            if response.status != 200:
                raise RuntimeError(f"Supervisor control request failed ({response.status}).")
            payload = json.loads(response.read())
    except (OSError, URLError, json.JSONDecodeError):
        return None
    action = payload.get("action")
    return action if action in {"restart", "stop"} else None


def _wait_for_exit(process: subprocess.Popen[bytes] | None, timeout: float = 10) -> bool:
    if process is None:
        return True
    deadline = time.monotonic() + timeout
    while process.poll() is None and time.monotonic() < deadline:
        time.sleep(0.1)
    return process.poll() is not None


def _require_docker_engine(docker: str) -> None:
    try:
        result = subprocess.run(
            [docker, "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            "Docker Desktop is required. Open Docker Desktop, wait until its engine is running, "
            "then run `python app.py` again."
        ) from exc

    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        message = (
            "Docker Desktop is required to run ZEUS. Open Docker Desktop and wait until it "
            "shows that the engine is running, then run `python app.py` again."
        )
        if detail:
            message = f"{message}\nDocker reported: {detail}"
        raise RuntimeError(message)


def _uses_managed_database() -> bool:
    return os.environ.get("ZEUS_MANAGED_DATABASE", "").strip().lower() == "true"


def _configured_port(name: str, default: int) -> int:
    try:
        port = int(os.environ.get(name) or str(default))
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a valid TCP port.") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError(f"{name} must be between 1 and 65535.")
    return port


def _webui_port() -> int:
    return _configured_port("WEBUI_PORT", 3000)


def _selected_platforms(value: str | None = None) -> tuple[str, ...]:
    raw = os.environ.get("PLATFORM", "webui") if value is None else value
    selected = [item.strip().lower() for item in raw.split(",") if item.strip()]
    if not selected:
        selected = ["webui"]
    if "webui" not in selected:
        selected.insert(0, "webui")
    unsupported = set(selected) - {"webui", "discord", "telegram"}
    if unsupported:
        raise RuntimeError(
            f"Unsupported platform(s) {', '.join(sorted(unsupported))}. "
            "Choose WebUI and optionally Discord or Telegram."
        )
    bot_platforms = [item for item in selected if item in {"discord", "telegram"}]
    if len(bot_platforms) > 1:
        raise RuntimeError("Select at most one additional platform: Discord or Telegram.")
    return ("webui", *bot_platforms)


def _start_webui(node: str, bridge_port: int) -> tuple[subprocess.Popen[str], subprocess.Popen[str]]:
    environment = os.environ.copy()
    environment.update({
        "BRIDGE_HOST": os.environ.get("BRIDGE_HOST", "127.0.0.1"),
        "BRIDGE_PORT": str(bridge_port),
        "BRIDGE_URL": f"http://127.0.0.1:{bridge_port}",
        "ZEUS_SUPERVISED_BRIDGE": "true",
    })
    bridge = subprocess.Popen(
        [sys.executable, "-m", "src.discord_bridge"],
        cwd=ROOT,
        env=environment,
    )
    try:
        _wait_for_bridge(bridge, bridge_port)
        server = subprocess.Popen(
            [node, str(ROOT / "webui" / "app.js")],
            cwd=ROOT,
            env=environment,
        )
    except Exception:
        _stop_process(bridge)
        raise
    return bridge, server


def run_webui() -> int:
    if not os.environ.get("DB_PASSWORD"):
        raise RuntimeError("Set DB_PASSWORD in .env or run `python setup.py` to generate it.")
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required to start the WebUI.")

    if not _uses_managed_database():
        docker = shutil.which("docker")
        if docker is None:
            raise RuntimeError("Docker is required to start the shared PostgreSQL database.")
        _require_docker_engine(docker)
        subprocess.run(
            [docker, "compose", "up", "-d", "--wait", "postgres"],
            cwd=ROOT,
            check=True,
        )

    bridge: subprocess.Popen[str] | None = None
    server: subprocess.Popen[str] | None = None
    try:
        bridge_port = _configured_port("BRIDGE_PORT", 5000)
        bridge, server = _start_webui(node, bridge_port)
        print("ZEUS WebUI is running. Press Ctrl+C to stop.")
        while True:
            if bridge.poll() is not None:
                raise RuntimeError(f"The WebUI inference bridge exited (code {bridge.returncode}).")
            server_code = server.poll()
            if server_code is not None:
                return server_code
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping ZEUS WebUI...")
        return 0
    finally:
        _stop_process(server)
        _stop_process(bridge)


def run_platform(
    *,
    name: str,
    record_logs: bool = False,
    with_webui: bool = False,
) -> int:
    token = os.environ.get(f"{name.upper()}_BOT_API_KEY" if name == "discord" else "TELEGRAM_BOT_API_KEY", "")
    if not token or token == "YOUR_BOT_TOKEN":
        raise RuntimeError(f"Set the API key in .env before starting {name}.")
    
    if name == "discord":
        if not os.environ.get("PFX") or os.environ["PFX"] == "YOUR_BOT_PREFIX":
            raise RuntimeError("Set PFX in .env before starting Discord.")

    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required to start the platform.")
    if not os.environ.get("DB_PASSWORD"):
        raise RuntimeError("Set DB_PASSWORD in .env or run `python setup.py` to generate it.")

    managed_database = _uses_managed_database()
    docker = None
    if not managed_database:
        docker = shutil.which("docker")
        if docker is None:
            raise RuntimeError("Docker is required to start the shared PostgreSQL database.")
        _require_docker_engine(docker)

    port = _configured_port("BRIDGE_PORT", 5000)
    bridge: subprocess.Popen[str] | None = None
    bot: subprocess.Popen[str] | None = None
    webui_bridge: subprocess.Popen[str] | None = None
    webui_server: subprocess.Popen[str] | None = None
    recorder = _RunLogRecorder() if record_logs else None
    try:
        if managed_database:
            print("Using PostgreSQL provided by the container orchestrator.")
        elif recorder:
            recorder.record("Starting the shared PostgreSQL database.")
            compose = subprocess.run(
                [docker, "compose", "up", "-d", "--wait", "postgres"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if compose.stdout:
                recorder.record(compose.stdout.rstrip())
            if compose.stderr:
                recorder.record(compose.stderr.rstrip())
            if compose.returncode:
                raise subprocess.CalledProcessError(compose.returncode, compose.args)
        elif not managed_database:
            print("Starting the shared PostgreSQL database...")
            subprocess.run(
                [docker, "compose", "up", "-d", "--wait", "postgres"],
                cwd=ROOT,
                check=True,
            )

        bridge_options: dict[str, object] = {"cwd": ROOT}
        if recorder:
            bridge_options.update(stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                  encoding="utf-8", errors="replace", bufsize=1)
        # Both platform adapters use the shared inference bridge.
        bridge = subprocess.Popen([sys.executable, "-m", f"src.{name}_bridge"], **bridge_options)
        if recorder and bridge.stdout:
            recorder.attach("bridge", bridge.stdout, show_startup=True)
        _wait_for_bridge(bridge, port)
        if recorder:
            recorder.health_log_received.wait(timeout=1)
        bot_environment = os.environ.copy()
        bot_environment["ZEUS_SUPERVISED"] = "1"
        bot_environment["PLATFORM"] = name
        if with_webui:
            webui_port = _webui_port()
            healthcheck_port = _configured_port("HEALTHCHECK_PORT", 3001)
            if healthcheck_port == webui_port:
                raise RuntimeError("HEALTHCHECK_PORT must differ from WEBUI_PORT.")
            bot_environment["HEALTHCHECK_PORT"] = str(healthcheck_port)
        bot_command = [node, str(ROOT / "platform" / name / "index.js")]
        bot_options: dict[str, object] = {"cwd": ROOT, "env": bot_environment}
        if recorder:
            bot_options.update(stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               encoding="utf-8", errors="replace", bufsize=1)
        bot = subprocess.Popen(bot_command, **bot_options)
        if recorder and bot.stdout:
            recorder.attach(name, bot.stdout)
        if with_webui:
            webui_bridge_port = _configured_port("WEBUI_BRIDGE_PORT", port + 1)
            if webui_bridge_port == port:
                raise RuntimeError("WEBUI_BRIDGE_PORT must differ from BRIDGE_PORT.")
            webui_bridge, webui_server = _start_webui(node, webui_bridge_port)
            print(f"ZEUS WebUI is available at http://localhost:{_webui_port()}.")
        if recorder:
            recorder.record(f"ZEUS {name} platform is running.")
        print(f"ZEUS {name} platform is running. Press Ctrl+C to stop.")
        while True:
            if bridge.poll() is not None:
                raise RuntimeError(f"The inference bridge exited (code {bridge.returncode}).")
            if webui_bridge and webui_bridge.poll() is not None:
                raise RuntimeError(
                    f"The WebUI inference bridge exited (code {webui_bridge.returncode})."
                )
            if webui_server and webui_server.poll() is not None:
                raise RuntimeError(f"The WebUI server exited (code {webui_server.returncode}).")
            action = _poll_control(port)
            if action == "stop":
                if recorder:
                    recorder.record("Received safe shutdown request.")
                else:
                    print("Received safe shutdown request.")
                if not _wait_for_exit(bot):
                    _stop_process(bot)
                return 0
            if action == "restart":
                if recorder:
                    recorder.record(f"Received restart request; restarting the {name} bot.")
                else:
                    print(f"Received restart request; restarting the {name} bot.")
                if not _wait_for_exit(bot):
                    _stop_process(bot)
                bot = subprocess.Popen(bot_command, **bot_options)
                if recorder and bot.stdout:
                    recorder.attach(name, bot.stdout)
                continue
            bot_code = bot.poll()
            if bot_code is not None:
                return bot_code
            time.sleep(0.5)
    except KeyboardInterrupt:
        if recorder:
            recorder.record("Stopping ZEUS after keyboard interrupt.")
        else:
            print("\nStopping ZEUS...")
        return 0
    except Exception as exc:
        if recorder:
            recorder.record(f"Startup or runtime failure: {exc}")
        raise
    finally:
        _stop_process(bot)
        _stop_process(webui_server)
        _stop_process(webui_bridge)
        _stop_process(bridge)
        if recorder:
            recorder.finish()


def main() -> int:
    if not (ROOT / ".env").exists() and not _uses_managed_database():
        raise RuntimeError("Missing .env. Run `python setup.py` first.")
    parser = argparse.ArgumentParser(description="Start ZEUS.")
    parser.add_argument(
        "--logs",
        action="store_true",
        help="save process logs on shutdown while keeping the console quiet",
    )
    args = parser.parse_args()
    platforms = _selected_platforms()
    bot_platform = next((name for name in platforms if name != "webui"), None)
    if bot_platform:
        return run_platform(
            name=bot_platform,
            record_logs=args.logs if bot_platform == "discord" else False,
            with_webui=True,
        )
    return run_webui()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"ZEUS startup failed: command exited with status {exc.returncode}: {exc.cmd}", file=sys.stderr)
        raise SystemExit(exc.returncode or 1) from exc
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"ZEUS startup failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

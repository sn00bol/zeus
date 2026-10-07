"""Interactive ZEUS setup and platform dependency installer."""

from __future__ import annotations

import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent
PROVIDERS = {
    "ollama": {"host": "localhost", "port": 11434},
    "lmstudio": {"host": "localhost", "port": 1234},
    "llamacpp": {"host": "localhost", "port": 8080},
}
PLATFORMS = {"1": "discord", "2": "telegram"}


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if match:
            value = match.group(2).split("#", 1)[0].strip().strip("\"'")
            values[match.group(1)] = value
    return values


def update_env(path: Path, values: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    updated: set[str] = set()
    result: list[str] = []
    for line in lines:
        match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        key = match.group(1) if match else None
        if key in values:
            result.append(f"{key}={values[key]}")
            updated.add(key)
        else:
            result.append(line)
    for key, value in values.items():
        if key not in updated:
            result.append(f"{key}={value}")
    path.write_text("\n".join(result) + "\n", encoding="utf-8")


def npm_install_command() -> list[str]:
    npm_path = shutil.which("npm.cmd") or shutil.which("npm")
    if npm_path is None:
        raise RuntimeError("npm is required to install the Discord platform dependencies.")
    if Path(npm_path).suffix.lower() in {".cmd", ".bat"}:
        node_path = shutil.which("node.exe") or shutil.which("node")
        if node_path is None:
            raise RuntimeError("Node.js is required to install the Discord platform dependencies.")
        npm_cli = Path(npm_path).parent / "node_modules" / "npm" / "bin" / "npm-cli.js"
        if not npm_cli.is_file():
            raise RuntimeError(f"Could not locate npm's CLI script at {npm_cli}.")
        return [node_path, str(npm_cli), "install", "--no-audit", "--no-fund"]
    return [npm_path, "install", "--no-audit", "--no-fund"]


def choose_platform(input_fn: Callable[[str], str]) -> str:
    while True:
        choice = input_fn("Choose platform [1] Discord / [2] Telegram: ").strip()
        if choice in PLATFORMS:
            return PLATFORMS[choice]
        print("Please choose 1 (Discord) or 2 (Telegram).")


def choose_provider(
    input_fn: Callable[[str], str],
    current_provider: str,
) -> str:
    default = current_provider if current_provider in PROVIDERS else "ollama"
    while True:
        choice = input_fn(
            f"Choose LLM [ollama/lmstudio/llamacpp] (default {default}): "
        ).strip().lower() or default
        if choice in PROVIDERS:
            return choice
        print("Please choose ollama, lmstudio, or llamacpp.")


def setup_project(
    root: Path = ROOT,
    input_fn: Callable[[str], str] | None = None,
    run_command: Callable[..., subprocess.CompletedProcess[object]] | None = None,
) -> dict[str, str]:
    prompt = input_fn or input
    run = run_command or subprocess.run
    env_path = root / ".env"
    if not env_path.exists():
        shutil.copyfile(root / ".env.example", env_path)
        print("Created .env from .env.example.")

    existing = read_env(env_path)
    
    # Skip selection if already configured
    if existing.get("CIG") == "true":
        print("Configuration found (CIG=true). Skipping platform and token selection...")
        platform = existing.get("PLATFORM")
        provider = existing.get("ZEUS_PROVIDER", "ollama")
        host = existing.get("LLM_HOST", "localhost")
        port = existing.get("LLM_PORT", "11434")
        
        # Ensure basic config exists
        config = {
            "PLATFORM": platform,
            "ZEUS_PROVIDER": provider,
            "LLM_HOST": host,
            "LLM_PORT": port,
            "DB_HOST": existing.get("DB_HOST") or "127.0.0.1",
            "DB_PORT": existing.get("DB_PORT") or "5432",
            "DB_NAME": existing.get("DB_NAME") or "zeus",
            "DB_USER": existing.get("DB_USER") or "zeus",
            "DB_PASSWORD": existing.get("DB_PASSWORD") or secrets.token_urlsafe(32),
        }
    else:
        platform = choose_platform(prompt)
        provider = choose_provider(prompt, existing.get("ZEUS_PROVIDER", "ollama"))
        defaults = PROVIDERS[provider]
        host = prompt(f"LLM host (default {defaults['host']}): ").strip() or defaults["host"]
        port_text = prompt(f"LLM port (default {defaults['port']}): ").strip() or str(defaults["port"])
        try:
            port = int(port_text)
        except ValueError as exc:
            raise ValueError("LLM port must be a number.") from exc
        if not 1 <= port <= 65535:
            raise ValueError("LLM port must be between 1 and 65535.")

        config = {
            "PLATFORM": platform,
            "ZEUS_PROVIDER": provider,
            "LLM_HOST": host,
            "LLM_PORT": str(port),
            "DB_HOST": existing.get("DB_HOST") or "127.0.0.1",
            "DB_PORT": existing.get("DB_PORT") or "5432",
            "DB_NAME": existing.get("DB_NAME") or "zeus",
            "DB_USER": existing.get("DB_USER") or "zeus",
            "DB_PASSWORD": existing.get("DB_PASSWORD") or secrets.token_urlsafe(32),
        }

        if platform == "discord":
            import getpass
            bot_token = getpass.getpass("Enter Discord Bot Token: ").strip()
            bot_prefix = prompt(f"Enter Bot Prefix (default empty): ").strip() or ""
            config["DISCORD_BOT_API_KEY"] = bot_token
            config["PFX"] = bot_prefix
        
        # Mark as configured
        config["CIG"] = "true"

    update_env(env_path, config)

    if platform == "discord":
        print("Installing platform dependencies...")
        run(npm_install_command(), cwd=root, check=True)
        print("Installing Python dependencies...")
        run(
            [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"],
            cwd=root,
            check=True,
        )
    else:
        print("Telegram support is not implemented yet; no Telegram dependencies were installed.")

    print(f"Setup complete. Selected platform: {platform}; LLM provider: {provider}.")
    if platform == "discord":
        print("Configuration saved. Now run: python app.py")
    return config




def main() -> None:
    try:
        setup_project()
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"Setup failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()

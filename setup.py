"""Interactive ZEUS setup and platform dependency installer (Enhanced UI/UX)."""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import re
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent

PROVIDERS = {
    "ollama": {"host": "localhost", "port": 11434, "desc": "Local Ollama instance"},
    "lmstudio": {"host": "localhost", "port": 1234, "desc": "LM Studio Local Server"},
    "llamacpp": {"host": "localhost", "port": 8080, "desc": "llama.cpp HTTP Server"},
}

OPTIONAL_PLATFORMS = ("discord", "telegram")

# ==========================================
# UI Styling & Helpers
# ==========================================
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    MAGENTA = "\033[95m"
    BLUE = "\033[94m"

BANNER = f"""{Colors.YELLOW}{Colors.BOLD}
  ███████╗███████╗██╗  ██╗███████╗
  ╚══███═╝██╔════╝██║  ██║██╔════╝
    ███╔╝ █████╗  ██║  ██║███████╗
   ███╔╝  ██╔══╝  ██║  ██║╚════██║
  ███████╗███████╗╚█████╔╝███████║
  ╚══════╝╚══════╝ ╚════╝ ╚══════╝
"""

def print_step(title: str) -> None:
    print(f"\n{Colors.BOLD}{Colors.BLUE}===> {title}{Colors.RESET}")

def print_success(msg: str) -> None:
    print(f"{Colors.GREEN}✔ {msg}{Colors.RESET}")

def print_warning(msg: str) -> None:
    print(f"{Colors.YELLOW}⚠ {msg}{Colors.RESET}")

def print_error(msg: str) -> None:
    print(f"{Colors.RED}✖ {msg}{Colors.RESET}")

def print_info(msg: str) -> None:
    print(f"{Colors.CYAN}ℹ {msg}{Colors.RESET}")

def run_with_spinner(cmd: list[str], cwd: Path, desc: str) -> None:
    """Run a subprocess command with a stylish terminal spinner."""
    spinner_chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    proc = subprocess.Popen(
        cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True
    )
    idx = 0
    while proc.poll() is None:
        sys.stdout.write(f"\r{Colors.CYAN}{spinner_chars[idx % len(spinner_chars)]}{Colors.RESET} {desc}...")
        sys.stdout.flush()
        idx += 1
        time.sleep(0.08)
    
    sys.stdout.write("\r" + " " * (len(desc) + 15) + "\r")  # Clear line
    
    if proc.returncode != 0:
        _, stderr = proc.communicate()
        print_error(f"Failed to {desc.lower()}")
        if stderr:
            print(f"{Colors.DIM}{stderr.strip()}{Colors.RESET}")
        raise subprocess.CalledProcessError(proc.returncode, cmd)
    
    print_success(f"{desc} completed.")

# ==========================================
# Core Utility Functions
# ==========================================
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


def update_env(
    path: Path,
    values: dict[str, str],
    *,
    remove_keys: set[str] | None = None,
) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    remove_keys = remove_keys or set()
    updated: set[str] = set()
    result: list[str] = []
    for line in lines:
        match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        key = match.group(1) if match else None
        if key in remove_keys:
            continue
        if key and key in values:
            result.append(f"{key}={values[key]}")
            updated.add(key)
        else:
            result.append(line)
    for key, value in values.items():
        if key not in updated and key not in remove_keys:
            result.append(f"{key}={value}")
    path.write_text("\n".join(result) + "\n", encoding="utf-8")


def save_platform_settings(
    root: Path,
    platform_selection: str,
    config: dict[str, str],
    *,
    save_platforms: bool = True,
    save_model_configuration: bool = True,
) -> None:
    async def save() -> None:
        import asyncpg

        connection = await asyncpg.connect(
            host=config["DB_HOST"],
            port=int(config["DB_PORT"]),
            database=config["DB_NAME"],
            user=config["DB_USER"],
            password=config["DB_PASSWORD"],
        )
        try:
            schema = (root / "database" / "schema.sql").read_text(encoding="utf-8")
            await connection.execute(schema)
            if save_model_configuration:
                await connection.execute(
                    """
                    INSERT INTO model_configuration
                        (setting_id, provider_name, model_id, ollama_api_key, updated_at)
                    VALUES (1, $1, $2, NULLIF($3, ''), NOW())
                    ON CONFLICT (setting_id) DO UPDATE
                    SET provider_name = EXCLUDED.provider_name,
                        model_id = EXCLUDED.model_id,
                        ollama_api_key = COALESCE(
                            EXCLUDED.ollama_api_key,
                            model_configuration.ollama_api_key
                        ),
                        updated_at = NOW()
                    """,
                    config.get("ZEUS_PROVIDER") or None,
                    config.get("ZEUS_MODEL") or None,
                    config.get("OLLAMA_API_KEY", ""),
                )
            if save_platforms:
                selected = set(_normalize_platform_selection(platform_selection).split(","))
                await connection.executemany(
                    """
                    INSERT INTO platform_settings (platform, enabled, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (platform) DO UPDATE
                    SET enabled = EXCLUDED.enabled, updated_at = NOW()
                    """,
                    [(name, name in selected) for name in ("webui", "discord", "telegram")],
                )
        finally:
            await connection.close()

    try:
        asyncio.run(save())
        return
    except Exception as initial_error:
        docker = shutil.which("docker")
        if docker is None:
            raise RuntimeError(
                f"Could not save platform settings to PostgreSQL: {initial_error}"
            ) from initial_error

    subprocess.run(
        [docker, "compose", "up", "-d", "--wait", "postgres"],
        cwd=root,
        check=True,
    )
    try:
        asyncio.run(save())
    except Exception as error:
        raise RuntimeError(f"Could not save platform settings to PostgreSQL: {error}") from error


def npm_install_command() -> list[str]:
    npm_path = shutil.which("npm.cmd") or shutil.which("npm")
    if npm_path is None:
        raise RuntimeError("npm is required to install Discord platform dependencies.")
    if Path(npm_path).suffix.lower() in {".cmd", ".bat"}:
        node_path = shutil.which("node.exe") or shutil.which("node")
        if node_path is None:
            raise RuntimeError("Node.js is required to install Discord platform dependencies.")
        npm_cli = Path(npm_path).parent / "node_modules" / "npm" / "bin" / "npm-cli.js"
        if not npm_cli.is_file():
            raise RuntimeError(f"Could not locate npm's CLI script at {npm_cli}.")
        return [node_path, str(npm_cli), "install", "--no-audit", "--no-fund"]
    return [npm_path, "install", "--no-audit", "--no-fund"]


# ==========================================
# Interactive Prompt Helpers
# ==========================================
def _read_menu_key() -> str:
    if sys.platform == "win32":
        import msvcrt

        key = msvcrt.getwch()
        if key in {"\x00", "\xe0"}:
            key = msvcrt.getwch()
            return {"H": "up", "P": "down"}.get(key, "")
        return {"\r": "enter", "\x03": "interrupt", " ": "space"}.get(key, "")

    import termios
    import tty

    descriptor = sys.stdin.fileno()
    previous_settings = termios.tcgetattr(descriptor)
    try:
        tty.setraw(descriptor)
        key = sys.stdin.read(1)
        if key == "\x1b":
            key += sys.stdin.read(2)
            return {"\x1b[A": "up", "\x1b[B": "down"}.get(key, "")
        return {"\r": "enter", "\n": "enter", "\x03": "interrupt", " ": "space"}.get(key, "")
    finally:
        termios.tcsetattr(descriptor, termios.TCSADRAIN, previous_settings)


def _choose_option(
    title: str,
    options: list[tuple[str, str]],
    default: str,
    input_fn: Callable[[str], str] | None = None,
) -> str:
    selected = next((i for i, (value, _) in enumerate(options) if value == default), 0)

    if input_fn is not None or not (sys.stdin.isatty() and sys.stdout.isatty()):
        print_step(title)
        for index, (value, label) in enumerate(options, start=1):
            marker = " (default)" if value == default else ""
            print(f"  {index}. {label}{marker}")
        choices = {str(index): value for index, (value, _) in enumerate(options, start=1)}
        choices.update({value.lower(): value for value, _ in options})
        while True:
            answer = (input_fn or input)(f"Enter choice [{selected + 1}]: ").strip().lower()
            if not answer:
                return options[selected][0]
            if answer in choices:
                return choices[answer]
            print_error("Invalid selection. Choose one of the listed options.")

    print_step(title)
    menu_height = len(options)

    def render() -> None:
        for index, (_, label) in enumerate(options):
            marker = ">" if index == selected else " "
            sys.stdout.write(f"\r\033[2K  {marker} {label}\n")
        sys.stdout.flush()

    render()
    while True:
        key = _read_menu_key()
        if key == "interrupt":
            raise KeyboardInterrupt
        if key == "enter":
            return options[selected][0]
        if key in {"up", "down"}:
            selected = (selected + (-1 if key == "up" else 1)) % len(options)
            sys.stdout.write(f"\033[{menu_height}A")
            render()


def _normalize_platform_selection(value: str) -> str:
    selected = [name.strip().lower() for name in value.split(",") if name.strip()]
    if not selected:
        selected = ["webui"]
    if "webui" not in selected:
        selected.insert(0, "webui")
    optional = [name for name in OPTIONAL_PLATFORMS if name in selected]
    unsupported = set(selected) - {"webui", *OPTIONAL_PLATFORMS}
    if unsupported:
        raise ValueError(f"Unsupported platform selection: {', '.join(sorted(unsupported))}.")
    return ",".join(["webui", *optional])


def choose_platform(
    input_fn: Callable[[str], str] | None = None,
    current_platform: str = "webui",
) -> str:
    default = _normalize_platform_selection(current_platform)
    default_choice = {
        "webui": "1",
        "webui,discord": "2",
        "webui,telegram": "3",
        "webui,discord,telegram": "4",
    }[default]
    if input_fn is not None or not (sys.stdin.isatty() and sys.stdout.isatty()):
        print_step("Select Platforms")
        options = [
            ("1", "WebUI (required)"),
            ("2", "WebUI + Discord"),
            ("3", "WebUI + Telegram (Experimental)"),
            ("4", "WebUI + Discord + Telegram (Experimental)"),
        ]
        for value, label in options:
            marker = " (default)" if value == default_choice else ""
            print(f"  {value}. {label}{marker}")
        while True:
            answer = (input_fn or input)(f"Choose an additional platform [{default_choice}]: ").strip().lower()
            if not answer:
                answer = default_choice
            if answer in {"1", "webui"}:
                return "webui"
            if answer in {"2", "discord"}:
                return "webui,discord"
            if answer in {"3", "telegram"}:
                return "webui,telegram"
            if answer in {"4", "discord,telegram", "telegram,discord"}:
                return "webui,discord,telegram"
            print_error("Choose WebUI only, WebUI + Discord, WebUI + Telegram, or both bots.")

    selected = _normalize_platform_selection(current_platform).split(",")
    cursor = 1
    options = [
        ("webui", "ZEUS WebUI (required)"),
        ("discord", "Discord"),
        ("telegram", "Telegram (Experimental)"),
    ]
    print_step("Select Platforms")

    def render() -> None:
        for index, (name, label) in enumerate(options):
            marker = ">" if index == cursor else " "
            checked = "x" if name == "webui" or name in selected else " "
            sys.stdout.write(f"\r\033[2K  {marker} [{checked}] {label}\n")
        sys.stdout.write("  Use ↑/↓ to navigate, Space to toggle, Enter to confirm.\n")
        sys.stdout.flush()

    render()
    while True:
        key = _read_menu_key()
        if key == "interrupt":
            raise KeyboardInterrupt
        if key == "up":
            cursor = 1 if cursor == 2 else 2
            sys.stdout.write("\033[4A")
            render()
        elif key == "down":
            cursor = 2 if cursor == 1 else 1
            sys.stdout.write("\033[4A")
            render()
        elif key == "space":
            choice = options[cursor][0]
            if choice in selected:
                selected.remove(choice)
            else:
                selected.append(choice)
            sys.stdout.write("\033[4A")
            render()
        elif key == "enter":
            optional = [name for name in OPTIONAL_PLATFORMS if name in selected]
            return ",".join(["webui", *optional])


def choose_provider(
    input_fn: Callable[[str], str] | None,
    current_provider: str,
) -> str:
    default = current_provider if current_provider in PROVIDERS else "ollama"
    options = [
        (name, f"{name} - {info['desc']}")
        for name, info in PROVIDERS.items()
    ]
    return _choose_option("Select LLM Provider", options, default, input_fn)


def discover_models(provider: str, host: str, port: int) -> list[str]:
    """Return model identifiers currently exposed by the configured local provider."""
    base_url = f"http://{host}:{port}"

    def fetch_json(path: str) -> dict[str, object]:
        request = urllib.request.Request(f"{base_url}{path}")
        with urllib.request.urlopen(request, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"Unexpected model-list response from {path}.")
        return data

    if provider == "ollama":
        data = fetch_json("/api/tags")
        entries = data.get("models", [])
        key = "name"
    else:
        try:
            data = fetch_json("/v1/models")
        except (urllib.error.URLError, TimeoutError, ValueError):
            if provider != "llamacpp":
                raise
            data = {}
        entries = data.get("data", [])
        key = "id"

    if not isinstance(entries, list):
        raise ValueError(f"Unexpected model list returned by {provider}.")
    models = [
        str(entry[key])
        for entry in entries
        if isinstance(entry, dict) and entry.get(key)
    ]
    if models or provider != "llamacpp":
        return models

    props = fetch_json("/props")
    model_path = str(props.get("model") or props.get("model_path") or "")
    model_id = Path(model_path.replace("\\", "/")).stem
    return [model_id] if model_id else []


def choose_model(
    provider: str,
    host: str,
    port: int,
    current_model: str = "",
    input_fn: Callable[[str], str] | None = None,
) -> str:
    print_info("Scanning the configured LLM provider for available models...")
    try:
        models = discover_models(provider, host, port)
    except (OSError, TimeoutError, ValueError) as exc:
        print_warning(f"Could not scan models: {exc}")
        models = []

    if models:
        print_success(f"Found {len(models)} model(s).")
    else:
        print_warning("No local models were found; Automatic will use runtime discovery.")
    options = [(model, model) for model in models]
    options.append(("", "Automatic"))
    default = current_model if current_model in models else ""
    return _choose_option("Available Local Models", options, default, input_fn)


# ==========================================
# Main Setup Flow
# ==========================================
def setup_project(
    root: Path = ROOT,
    input_fn: Callable[[str], str] | None = None,
    force_reconfig: bool = False,
) -> dict[str, str]:
    print(BANNER)
    prompt = input_fn or input

    env_path = root / ".env"
    env_example = root / ".env.example"

    if not env_path.exists():
        if env_example.exists():
            shutil.copyfile(env_example, env_path)
            print_success("Created .env from .env.example")
        else:
            env_path.touch()
            print_warning("No .env.example found. Created empty .env file.")

    existing = read_env(env_path)
    has_existing_model_configuration = any(
        existing.get(key)
        for key in ("ZEUS_PROVIDER", "ZEUS_MODEL", "OLLAMA_API_KEY", "OLLAMA_TOKEN")
    )
    preserve_platform_settings = (
        existing.get("CIG") == "true"
        and "PLATFORM" not in existing
        and not force_reconfig
    )

    # Allow force re-configuration or auto-skip if CIG=true
    if existing.get("CIG") == "true" and not force_reconfig:
        print_info("Existing configuration detected (CIG=true). Skipping...")
        print(f"  {Colors.DIM}Tip: Pass '--force' or '-f' flag to reconfigure.{Colors.RESET}\n")
        
        platform = _normalize_platform_selection(existing.get("PLATFORM", "webui"))
        provider = existing.get("ZEUS_PROVIDER", "ollama")
        config = {
            "ZEUS_PROVIDER": provider,
            "ZEUS_MODEL": existing.get("ZEUS_MODEL", ""),
            "LLM_HOST": existing.get("LLM_HOST", "localhost"),
            "LLM_PORT": existing.get("LLM_PORT", "11434"),
            "OLLAMA_API_KEY": (
                existing.get("OLLAMA_API_KEY") or existing.get("OLLAMA_TOKEN", "")
            ),
            "DB_HOST": existing.get("DB_HOST", "127.0.0.1"),
            "DB_PORT": existing.get("DB_PORT", "5432"),
            "DB_NAME": existing.get("DB_NAME", "zeus"),
            "DB_USER": existing.get("DB_USER", "zeus"),
            "DB_PASSWORD": existing.get("DB_PASSWORD") or secrets.token_urlsafe(32),
            "BRIDGE_TOKEN": existing.get("BRIDGE_TOKEN") or secrets.token_urlsafe(32),
            "SEARXNG_SECRET": existing.get("SEARXNG_SECRET") or secrets.token_urlsafe(32),
        }
        selected = set(platform.split(","))
        if (
            "discord" in selected
            and existing.get("DISCORD_BOT_API_KEY") in {None, "", "YOUR_BOT_TOKEN"}
        ):
            bot_token = ""
            while not bot_token:
                bot_token = getpass.getpass("Enter Discord Bot Token: ").strip()
                if not bot_token:
                    print_error("Token cannot be empty!")
            config["DISCORD_BOT_API_KEY"] = bot_token
            config["PFX"] = existing.get("PFX", "")
        if (
            "telegram" in selected
            and existing.get("TELEGRAM_BOT_API_KEY") in {None, "", "YOUR_BOT_TOKEN"}
        ):
            bot_token = ""
            while not bot_token:
                bot_token = getpass.getpass("Enter Telegram Bot Token: ").strip()
                if not bot_token:
                    print_error("Token cannot be empty!")
            config["TELEGRAM_BOT_API_KEY"] = bot_token
    else:
        platform = choose_platform(input_fn, existing.get("PLATFORM", "webui"))
        provider = choose_provider(input_fn, existing.get("ZEUS_PROVIDER", "ollama"))

        # Provider Host & Port
        defaults = PROVIDERS[provider]
        print_step("Configure LLM Connection")
        host = prompt(f"LLM Host ({Colors.CYAN}{defaults['host']}{Colors.RESET}): ").strip() or defaults["host"]
        
        while True:
            port_text = prompt(f"LLM Port ({Colors.CYAN}{defaults['port']}{Colors.RESET}): ").strip() or str(defaults["port"])
            try:
                port = int(port_text)
                if 1 <= port <= 65535:
                    break
                print_error("Port must be between 1 and 65535.")
            except ValueError:
                print_error("Port must be a valid integer.")

        model = choose_model(
            provider,
            host,
            port,
            existing.get("ZEUS_MODEL", ""),
            input_fn,
        )

        ollama_token = existing.get("OLLAMA_API_KEY") or existing.get("OLLAMA_TOKEN", "")
        if provider == "ollama":
            default_hint = f" [{ollama_token[:6]}...]" if ollama_token else ""
            ollama_input = prompt(f"Ollama API Token (optional, press Enter to skip){default_hint}: ").strip()
            if ollama_input:
                ollama_token = ollama_input

        config = {
            "ZEUS_PROVIDER": provider,
            "ZEUS_MODEL": model,
            "LLM_HOST": host,
            "LLM_PORT": str(port),
            "OLLAMA_API_KEY": ollama_token,
            "DB_HOST": existing.get("DB_HOST", "127.0.0.1"),
            "DB_PORT": existing.get("DB_PORT", "5432"),
            "DB_NAME": existing.get("DB_NAME", "zeus"),
            "DB_USER": existing.get("DB_USER", "zeus"),
            "DB_PASSWORD": existing.get("DB_PASSWORD") or secrets.token_urlsafe(32),
            "BRIDGE_TOKEN": existing.get("BRIDGE_TOKEN") or secrets.token_urlsafe(32),
            "SEARXNG_SECRET": existing.get("SEARXNG_SECRET") or secrets.token_urlsafe(32),
        }

        # Platform specific settings
        selected = set(platform.split(","))
        if "discord" in selected:
            print_step("Discord Bot Settings")
            bot_token = ""
            while not bot_token:
                bot_token = getpass.getpass("Enter Discord Bot Token: ").strip()
                if not bot_token:
                    print_error("Token cannot be empty!")
            
            bot_prefix = prompt("Enter Bot Prefix (default empty): ").strip()
            config["DISCORD_BOT_API_KEY"] = bot_token
            config["PFX"] = bot_prefix
        if "telegram" in selected:
            print_step("Telegram Bot Settings")
            bot_token = ""
            while not bot_token:
                bot_token = getpass.getpass("Enter Telegram Bot Token: ").strip()
                if not bot_token:
                    print_error("Token cannot be empty!")
            config["TELEGRAM_BOT_API_KEY"] = bot_token

        config["CIG"] = "true"

    model_configuration_keys = {
        "ZEUS_PROVIDER",
        "ZEUS_MODEL",
        "OLLAMA_API_KEY",
        "OLLAMA_TOKEN",
    }
    update_env(
        env_path,
        {
            key: value for key, value in config.items()
            if key not in model_configuration_keys
        },
        remove_keys={"PLATFORM"},
    )
    print_success("Configuration saved to .env")

    # Dependency Installation
    print_step("Installing Dependencies")
    run_with_spinner(npm_install_command(), cwd=root, desc="Installing Node.js dependencies")
    run_with_spinner([sys.executable, "-m", "pip", "install", "."], cwd=root, desc="Installing Python packages")
    if preserve_platform_settings:
        print_info("Keeping the existing selection stored in PostgreSQL.")
    save_platform_settings(
        root,
        platform,
        config,
        save_platforms=not preserve_platform_settings,
        save_model_configuration=(
            not preserve_platform_settings or has_existing_model_configuration
        ),
    )
    update_env(env_path, {}, remove_keys=model_configuration_keys)
    if not preserve_platform_settings:
        print_success("Selection saved to PostgreSQL.")
    if "telegram" in platform.split(","):
        print_warning("Telegram support is currently in preview and testing")

    # Summary
    print(f"\n{Colors.GREEN}{Colors.BOLD}🎉 ZEUS Setup Complete!{Colors.RESET}")
    print(f"To run ZEUS, use {Colors.BOLD}{Colors.YELLOW}docker compose up -d --build{Colors.RESET}\n")

    return config


def main() -> None:
    parser = argparse.ArgumentParser(description="ZEUS Agent Interactive Setup")
    parser.add_argument("-f", "--force", action="store_true", help="Force re-configuration even if CIG is true")
    args = parser.parse_args()

    try:
        setup_project(force_reconfig=args.force)
    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Setup cancelled by user.{Colors.RESET}")
        sys.exit(130)
    except Exception as exc:
        print_error(f"Setup failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    if any(
        argument in {"bdist_wheel", "build", "clean", "dist_info", "egg_info", "sdist"}
        for argument in sys.argv[1:]
    ):
        from importlib import import_module

        import_module("setuptools").setup()
    else:
        main()
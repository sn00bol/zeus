"""Interactive ZEUS setup and platform dependency installer (Enhanced UI/UX)."""

from __future__ import annotations

import argparse
import getpass
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent

PROVIDERS = {
    "ollama": {"host": "localhost", "port": 11434, "desc": "Local Ollama instance"},
    "lmstudio": {"host": "localhost", "port": 1234, "desc": "LM Studio Local Server"},
    "llamacpp": {"host": "localhost", "port": 8080, "desc": "llama.cpp HTTP Server"},
}

PLATFORMS = {
    "1": ("discord", "Discord Bot Interface"),
    "2": ("telegram", "Telegram Bot Interface (Experimental)"),
}

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

BANNER = f"""{Colors.CYAN}{Colors.BOLD}
  ███████╗███████╗██╗  ██╗███████╗
  ╚══███═╝██╔════╝██║  ██║██╔════╝
    ███╔╝ █████╗  ██║  ██║███████╗
   ███╔╝  ██╔══╝  ██║  ██║╚════██║
  ███████╗███████╗╚█████╔╝███████║
  ╚══════╝╚══════╝ ╚════╝ ╚══════╝
{Colors.RESET}{Colors.DIM} A self-hosting AI Agent{Colors.RESET}
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


def update_env(path: Path, values: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    updated: set[str] = set()
    result: list[str] = []
    for line in lines:
        match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        key = match.group(1) if match else None
        if key and key in values:
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
def choose_platform(input_fn: Callable[[str], str]) -> str:
    print_step("Select Target Platform")
    for key, (name, desc) in PLATFORMS.items():
        print(f"  [{Colors.BOLD}{key}{Colors.RESET}] {name.capitalize():<10} {Colors.DIM}({desc}){Colors.RESET}")
    
    while True:
        choice = input_fn(f"\nEnter choice [1-{len(PLATFORMS)}]: ").strip()
        if choice in PLATFORMS:
            return PLATFORMS[choice][0]
        print_error("Invalid selection. Please enter 1 or 2.")


def choose_provider(input_fn: Callable[[str], str], current_provider: str) -> str:
    print_step("Select LLM Provider")
    default = current_provider if current_provider in PROVIDERS else "ollama"
    
    for key, info in PROVIDERS.items():
        marker = f"{Colors.GREEN}*(default)*{Colors.RESET}" if key == default else ""
        print(f"  • {Colors.BOLD}{key:<10}{Colors.RESET} - {info['desc']} {marker}")

    while True:
        choice = input_fn(f"\nEnter LLM provider ({Colors.CYAN}{default}{Colors.RESET}): ").strip().lower() or default
        if choice in PROVIDERS:
            return choice
        print_error("Invalid choice. Choose ollama, lmstudio, or llamacpp.")


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

    # Allow force re-configuration or auto-skip if CIG=true
    if existing.get("CIG") == "true" and not force_reconfig:
        print_info("Existing configuration detected (CIG=true). Skipping...")
        print(f"  {Colors.DIM}Tip: Pass '--force' or '-f' flag to reconfigure.{Colors.RESET}\n")
        
        platform = existing.get("PLATFORM", "discord")
        provider = existing.get("ZEUS_PROVIDER", "ollama")
        config = {
            "PLATFORM": platform,
            "ZEUS_PROVIDER": provider,
            "LLM_HOST": existing.get("LLM_HOST", "localhost"),
            "LLM_PORT": existing.get("LLM_PORT", "11434"),
            "DB_HOST": existing.get("DB_HOST", "127.0.0.1"),
            "DB_PORT": existing.get("DB_PORT", "5432"),
            "DB_NAME": existing.get("DB_NAME", "zeus"),
            "DB_USER": existing.get("DB_USER", "zeus"),
            "DB_PASSWORD": existing.get("DB_PASSWORD") or secrets.token_urlsafe(32),
        }
    else:
        platform = choose_platform(prompt)
        provider = choose_provider(prompt, existing.get("ZEUS_PROVIDER", "ollama"))

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

        config = {
            "PLATFORM": platform,
            "ZEUS_PROVIDER": provider,
            "LLM_HOST": host,
            "LLM_PORT": str(port),
            "DB_HOST": existing.get("DB_HOST", "127.0.0.1"),
            "DB_PORT": existing.get("DB_PORT", "5432"),
            "DB_NAME": existing.get("DB_NAME", "zeus"),
            "DB_USER": existing.get("DB_USER", "zeus"),
            "DB_PASSWORD": existing.get("DB_PASSWORD") or secrets.token_urlsafe(32),
        }

        # Platform specific settings
        if platform == "discord":
            print_step("Discord Bot Settings")
            bot_token = ""
            while not bot_token:
                bot_token = getpass.getpass("Enter Discord Bot Token: ").strip()
                if not bot_token:
                    print_error("Token cannot be empty!")
            
            bot_prefix = prompt("Enter Bot Prefix (default empty): ").strip()
            config["DISCORD_BOT_API_KEY"] = bot_token
            config["PFX"] = bot_prefix

        config["CIG"] = "true"

    update_env(env_path, config)
    print_success("Configuration saved to .env")

    # Dependency Installation
    print_step("Installing Dependencies")
    if platform == "discord":
        run_with_spinner(npm_install_command(), cwd=root, desc="Installing Node.js dependencies")
        run_with_spinner([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], cwd=root, desc="Installing Python packages")
    else:
        print_warning("Telegram support is currently in preview and testing")

    # Summary
    print(f"\n{Colors.GREEN}{Colors.BOLD}🎉 ZEUS Setup Complete!{Colors.RESET}")
    print(f"  • Platform  : {Colors.CYAN}{platform}{Colors.RESET}")
    print(f"  • Provider  : {Colors.CYAN}{provider}{Colors.RESET}")
    print(f"  • LLM Target: {Colors.CYAN}{config['LLM_HOST']}:{config['LLM_PORT']}{Colors.RESET}\n")

    if platform == "discord":
        print(f"To run ZEUS, use {Colors.BOLD}{Colors.YELLOW}python app.py{Colors.RESET}\n")

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
    main()
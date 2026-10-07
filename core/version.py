"""Read the release version and derive a Docker-safe commit version suffix."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def get_version() -> str:
    version_file = ROOT / "version"
    try:
        base_version = version_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Could not read version file: {version_file}") from exc
    if not base_version:
        raise RuntimeError(f"Version file is empty: {version_file}")

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=6", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return base_version
    if result.returncode != 0:
        return base_version
    commit = result.stdout.strip()
    return f"{base_version}.{commit}" if commit else base_version


if __name__ == "__main__":
    print(get_version())

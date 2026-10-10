"""Shared skill document types."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SkillSpec:
    """A catalog skill: task metadata plus the full markdown body."""

    name: str
    slug: str
    description: str
    when_to_use: str
    body: str
    path: Path


@dataclass(frozen=True)
class CoreDocuments:
    """Always-on instruction files that are never selected from the catalog."""

    soul: str
    safety: str
    skill: str

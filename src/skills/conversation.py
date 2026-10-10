"""Assemble conversation system context from SOUL, SAFETY, SKILL.md, and selected skills."""

from __future__ import annotations

from .runtime import SkillRuntime
from .types import CoreDocuments, SkillSpec

DEFAULT_TEMPERATURE = 0.7


class ConversationComposer:
    """Build the always-on instruction bundle plus any auto-selected skills."""

    def __init__(self, core: CoreDocuments) -> None:
        self._core = core

    def build_system_content(self, selected: list[SkillSpec] | None = None) -> str:
        parts = [
            self._core.soul,
            self._core.safety,
            self._core.skill,
        ]
        for skill in selected or []:
            parts.append(
                f"# Active skill: {skill.name}\n\n"
                "Follow this skill if it matches the current goal. "
                "If it does not match, ignore it.\n\n"
                f"{skill.body}"
            )
        return "\n\n".join(parts)

    def build_system_message(self, selected: list[SkillSpec] | None = None) -> dict[str, str]:
        return {"role": "system", "content": self.build_system_content(selected)}


def compose_system_message(
    query: str,
    *,
    runtime: SkillRuntime | None = None,
    recent: str = "",
) -> dict[str, str]:
    """Select skills for *query* and return a single system message."""
    active = runtime or SkillRuntime()
    selected = active.select(query, recent=recent)
    return ConversationComposer(active.core).build_system_message(selected)

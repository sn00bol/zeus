"""
src/skills/personality — Bot personality definitions.

A Personality bundles the system-prompt and tone that shapes the LLM's
responses.  Additional skills (memory, RAG, tools …) will be added here
later as the project evolves.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class Personality:
    """
    Defines the character, tone, and base instructions injected into every
    LLM conversation as the system prompt.

    Attributes
    ----------
    name : str
        Human-readable persona name shown in debug / logs.
    system_prompt : str
        Full system-level instruction sent to the model before any user turn.
    language : str
        Primary response language hint (e.g. ``"en"``, ``"vi"``).
    temperature : float
        Sampling temperature override (0.0 – 2.0).  Use ``None`` to let the
        caller decide.
    extra_context : list[str]
        Additional context blocks appended after the system prompt; useful
        for injecting server-specific rules at runtime.
    """

    name: str = "Zeus"
    system_prompt: str = (
        "You are Zeus, a helpful and knowledgeable AI assistant. "
        "You answer questions clearly and concisely. "
        "When you don't know something, say so honestly. "
        "Adapt your tone to match the user: casual for casual questions, "
        "precise for technical ones."
    )
    language: str = "en"
    temperature: float = 0.7
    extra_context: list[str] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def build_system_message(self) -> dict[str, str]:
        """Return the system-role dict ready to prepend to a messages list."""
        parts = [self.system_prompt]
        parts.extend(self.extra_context)
        return {"role": "system", "content": "\n\n".join(parts)}

    def with_context(self, *blocks: str) -> "Personality":
        """Return a shallow copy with additional context blocks appended."""
        return Personality(
            name=self.name,
            system_prompt=self.system_prompt,
            language=self.language,
            temperature=self.temperature,
            extra_context=list(self.extra_context) + list(blocks),
        )

    def __repr__(self) -> str:
        return f"<Personality '{self.name}' lang={self.language} temp={self.temperature}>"


# ---------------------------------------------------------------------------
# Built-in personalities
# ---------------------------------------------------------------------------

#: Default balanced persona
DEFAULT = Personality()

#: More terse / technical persona for code-heavy channels
TECHNICAL = Personality(
    name="Zeus/Tech",
    system_prompt=(
        "You are Zeus in technical mode. "
        "Give precise, code-first answers. "
        "Use markdown code blocks. "
        "Be brief — skip pleasantries."
    ),
    temperature=0.3,
)

#: Friendly casual persona
CASUAL = Personality(
    name="Zeus/Casual",
    system_prompt=(
        "You are Zeus, a friendly and witty AI buddy. "
        "Chat casually, use emojis sparingly, and keep it fun. "
        "Still be helpful — just not robotic."
    ),
    temperature=0.9,
)


def get_personality(name: str | None = None) -> Personality:
    """
    Retrieve a built-in personality by name or via the ``ZEUS_PERSONALITY``
    environment variable.

    Falls back to :data:`DEFAULT` if the name is not recognised.
    """
    key = (name or os.environ.get("ZEUS_PERSONALITY", "default")).lower()
    return {
        "default":   DEFAULT,
        "technical": TECHNICAL,
        "tech":      TECHNICAL,
        "casual":    CASUAL,
    }.get(key, DEFAULT)

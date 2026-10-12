"""Typed distinction between conversation history and extracted user facts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any


class MemoryKind(StrEnum):
    CONVERSATION_TURN = "conversation_turn"
    EXTRACTED_FACT = "extracted_fact"


@dataclass(frozen=True)
class MemoryEntry:
    content: str
    kind: MemoryKind
    created_at: datetime | None = None
    source: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RecallResult:
    entries: tuple[MemoryEntry, ...]
    query: str

    @property
    def is_empty(self) -> bool:
        return not self.entries

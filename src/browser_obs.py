"""Readable, bounded browser evidence with one canonical reference collection."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

MAX_EVIDENCE_CHARS = 12_000
MAX_REFERENCES = 64
MAX_REFERENCE_FIELD_CHARS = 512


@dataclass(frozen=True)
class BrowserReference:
    ref_id: str
    label: str
    href: str


@dataclass(frozen=True)
class BrowserObservation:
    url: str
    title: str
    text: str
    references: tuple[BrowserReference, ...]

    @classmethod
    def create(
        cls,
        *,
        url: str,
        title: str,
        text: str,
        references: Iterable[BrowserReference],
        max_chars: int = MAX_EVIDENCE_CHARS,
        max_references: int = MAX_REFERENCES,
    ) -> BrowserObservation:
        if max_chars < 0 or max_references < 0:
            raise ValueError("Browser evidence limits cannot be negative.")
        unique: dict[str, BrowserReference] = {}
        source = references if max_references else ()
        for reference in source:
            identity = reference.ref_id or reference.href
            if not identity or identity in unique:
                continue
            unique[identity] = BrowserReference(
                ref_id=reference.ref_id[:MAX_REFERENCE_FIELD_CHARS],
                label=reference.label[:MAX_REFERENCE_FIELD_CHARS],
                href=reference.href[:MAX_REFERENCE_FIELD_CHARS],
            )
            if len(unique) >= max_references:
                break
        return cls(
            url=url[:MAX_REFERENCE_FIELD_CHARS],
            title=title[:MAX_REFERENCE_FIELD_CHARS],
            text=text[:max_chars],
            references=tuple(unique.values()),
        )

    def as_payload(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "title": self.title,
            "text": self.text,
            "references": [
                {"ref_id": item.ref_id, "label": item.label, "href": item.href}
                for item in self.references
            ],
        }

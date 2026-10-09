"""Versioned append-only trace records and JSONL codecs for agent adapters."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class TraceRecord:
    trace_id: str
    sequence: int
    kind: str
    payload: dict[str, Any]
    timestamp: str
    version: int = 1

    @classmethod
    def create(
        cls,
        trace_id: str,
        sequence: int,
        kind: str,
        payload: dict[str, Any],
    ) -> TraceRecord:
        if (
            not trace_id.strip()
            or sequence < 0
            or not kind.strip()
            or not isinstance(payload, dict)
        ):
            raise ValueError("Trace ID, non-negative sequence, and event kind are required.")
        return cls(
            trace_id=trace_id,
            sequence=sequence,
            kind=kind,
            payload=payload,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )


def encode_trace(record: TraceRecord) -> bytes:
    """Encode one immutable trace event as a UTF-8 JSONL record."""
    return (
        json.dumps(
            {
                "version": record.version,
                "trace_id": record.trace_id,
                "sequence": record.sequence,
                "kind": record.kind,
                "timestamp": record.timestamp,
                "payload": record.payload,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def decode_trace(data: bytes | str) -> TraceRecord:
    """Decode a single JSONL trace record and reject unsupported versions."""
    value = json.loads(data)
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("Unsupported or malformed trace record.")
    payload = value.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Trace payload must be an object.")
    record = TraceRecord(
        trace_id=str(value.get("trace_id", "")),
        sequence=value.get("sequence", -1),
        kind=str(value.get("kind", "")),
        payload=payload,
        timestamp=str(value.get("timestamp", "")),
        version=1,
    )
    if (
        not record.trace_id
        or isinstance(record.sequence, bool)
        or not isinstance(record.sequence, int)
        or record.sequence < 0
    ):
        raise ValueError("Trace ID and non-negative integer sequence are required.")
    if not record.kind or not record.timestamp:
        raise ValueError("Trace kind and timestamp are required.")
    return record

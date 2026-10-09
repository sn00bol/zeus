"""Shared response shaping and Server-Sent Event serialization."""

from __future__ import annotations

import json
from typing import Any

from router.router import InferenceResponse


def event_frame(event_id: int, event: str, data: dict[str, Any]) -> bytes:
    """Encode a replayable event using the browser EventSource wire format."""
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event_id}\nevent: {event}\ndata: {payload}\n\n".encode("utf-8")


def assistant_message(
    *,
    platform: str,
    conversation_id: str,
    user_id: str,
    response: InferenceResponse,
) -> dict[str, Any]:
    """Return the persisted assistant-message shape used by the existing WebUI."""
    from datetime import datetime, timezone
    from uuid import uuid4

    return {
        "platform": platform,
        "conversation_id": conversation_id,
        "message_id": str(uuid4()),
        "role": "assistant",
        "content": response.content,
        "provider": response.provider,
        "model": response.model,
        "user_id": user_id,
        "usage": {
            "prompt_tokens": response.prompt_tokens,
            "completion_tokens": response.completion_tokens,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

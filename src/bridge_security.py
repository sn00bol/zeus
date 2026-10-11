from __future__ import annotations

import hmac
import json
from typing import Any

MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024


class RequestBodyTooLarge(ValueError):
    """Raised when an HTTP JSON body exceeds the configured size limit."""


def is_authenticated(scope: dict[str, Any], expected_token: str) -> bool:
    if not expected_token:
        return False
    authorization = next(
        (
            value.decode("utf-8", errors="ignore")
            for name, value in scope.get("headers", [])
            if name.lower() == b"authorization"
        ),
        "",
    )
    scheme, separator, supplied_token = authorization.partition(" ")
    return (
        bool(separator)
        and scheme.lower() == "bearer"
        and hmac.compare_digest(
            supplied_token.encode("utf-8"),
            expected_token.encode("utf-8"),
        )
    )


async def read_json(receive: Any) -> dict[str, Any]:
    chunks: list[bytes] = []
    size = 0
    while True:
        event = await receive()
        if event["type"] == "http.disconnect":
            raise ValueError("Request disconnected before its body was received")
        chunk = event.get("body", b"")
        size += len(chunk)
        if size > MAX_REQUEST_BODY_BYTES:
            raise RequestBodyTooLarge("Request body is too large")
        chunks.append(chunk)
        if not event.get("more_body", False):
            break
    try:
        body = json.loads(b"".join(chunks))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid JSON body") from exc
    if not isinstance(body, dict):
        raise ValueError("JSON body must be an object")
    return body

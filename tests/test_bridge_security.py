from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from src import discord_bridge, telegram_bridge
from src.bridge_security import MAX_REQUEST_BODY_BYTES


class BridgeSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def _call(
        self,
        bridge: object,
        scope: dict[str, object],
        receive: AsyncMock,
    ) -> tuple[list[dict[str, object]], int]:
        responses: list[dict[str, object]] = []

        async def send(event: dict[str, object]) -> None:
            responses.append(event)

        await bridge.BridgeApplication()._http(scope, receive, send)  # type: ignore[attr-defined]
        return responses, int(responses[0]["status"])

    async def test_api_routes_reject_missing_or_invalid_bearer_token(self) -> None:
        protected_routes = (
            ("GET", "/status"),
            ("GET", "/sessions/usage"),
            ("GET", "/sessions/retry"),
            ("POST", "/sessions/reset"),
            ("POST", "/control"),
            ("GET", "/control/next"),
            ("POST", "/infer"),
            ("POST", "/agent/run"),
            ("GET", "/agent/runs/run-id"),
        )
        for bridge in (discord_bridge, telegram_bridge):
            with patch.object(bridge, "_BRIDGE_TOKEN", "expected-token"):
                for method, path in protected_routes:
                    for headers in ([], [(b"authorization", b"Bearer wrong-token")]):
                        with self.subTest(bridge=bridge.__name__, method=method, path=path):
                            receive = AsyncMock()
                            scope: dict[str, object] = {
                                "type": "http",
                                "method": method,
                                "path": path,
                                "headers": headers,
                            }
                            _, status = await self._call(bridge, scope, receive)
                            self.assertEqual(status, 401)
                            receive.assert_not_awaited()

    async def test_api_fails_closed_when_bridge_token_is_unconfigured(self) -> None:
        for bridge in (discord_bridge, telegram_bridge):
            with patch.object(bridge, "_BRIDGE_TOKEN", ""):
                _, status = await self._call(
                    bridge,
                    {"type": "http", "method": "GET", "path": "/models"},
                    AsyncMock(),
                )
            self.assertEqual(status, 503)

    async def test_health_remains_public_without_a_bridge_token(self) -> None:
        for bridge in (discord_bridge, telegram_bridge):
            with patch.object(bridge, "_BRIDGE_TOKEN", ""):
                responses, status = await self._call(
                    bridge,
                    {"type": "http", "method": "GET", "path": "/health"},
                    AsyncMock(),
                )
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(responses[1]["body"]), {"status": "ok"})

    async def test_oversized_json_body_returns_413(self) -> None:
        for bridge in (discord_bridge, telegram_bridge):
            payload = b"x" * (MAX_REQUEST_BODY_BYTES + 1)
            receive = AsyncMock(return_value={
                "type": "http.request",
                "body": payload,
                "more_body": False,
            })
            with patch.object(bridge, "_BRIDGE_TOKEN", "expected-token"):
                responses, status = await self._call(
                    bridge,
                    {
                        "type": "http",
                        "method": "POST",
                        "path": "/sessions/reset",
                        "headers": [(b"authorization", b"Bearer expected-token")],
                    },
                    receive,
                )
            self.assertEqual(status, 413)
            self.assertIn("too large", json.loads(responses[1]["body"])["error"])

    async def test_supervisor_control_preserves_target_platform(self) -> None:
        for bridge, platform in (
            (discord_bridge, "discord"),
            (telegram_bridge, "telegram"),
        ):
            while not bridge._control_queue.empty():
                bridge._control_queue.get_nowait()
            body = json.dumps({"action": "restart", "platform": platform}).encode()
            with patch.object(bridge, "_BRIDGE_TOKEN", "expected-token"):
                _, status = await self._call(
                    bridge,
                    {
                        "type": "http",
                        "method": "POST",
                        "path": "/control",
                        "headers": [(b"authorization", b"Bearer expected-token")],
                    },
                    AsyncMock(return_value={
                        "type": "http.request",
                        "body": body,
                        "more_body": False,
                    }),
                )
                responses, poll_status = await self._call(
                    bridge,
                    {
                        "type": "http",
                        "method": "GET",
                        "path": "/control/next",
                        "headers": [(b"authorization", b"Bearer expected-token")],
                    },
                    AsyncMock(),
                )

            self.assertEqual(status, 202)
            self.assertEqual(poll_status, 200)
            self.assertEqual(json.loads(responses[1]["body"]), {
                "action": "restart",
                "platform": platform,
            })


if __name__ == "__main__":
    unittest.main()

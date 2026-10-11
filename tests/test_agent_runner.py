from __future__ import annotations

import unittest
from types import SimpleNamespace

from router.agent import AgentRunner
from router.router import InferenceRequest, InferenceResponse, Message


class FakeStore:
    def __init__(self) -> None:
        self.request: InferenceRequest | None = None

    async def create(self, request: InferenceRequest) -> str:
        self.request = request
        return "agent-run"


class AgentRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_submit_enables_thinking_for_agent_runs_by_default(self) -> None:
        store = FakeStore()
        runner = AgentRunner(SimpleNamespace(broker=None), store)
        request = InferenceRequest(messages=[Message(role="user", content="hello")])

        run = await runner.submit(request)

        self.assertEqual(run.run_id, "agent-run")
        self.assertIsNotNone(store.request)
        self.assertTrue(store.request.extra["think"])

    async def test_submit_preserves_explicit_thinking_setting(self) -> None:
        store = FakeStore()
        runner = AgentRunner(SimpleNamespace(broker=None), store)
        request = InferenceRequest(
            messages=[Message(role="user", content="hello")],
            extra={"think": False},
        )

        await runner.submit(request)

        self.assertIsNotNone(store.request)
        self.assertIs(store.request.extra["think"], False)

    def test_status_payload_includes_model_thinking(self) -> None:
        result = InferenceResponse(
            content="answer",
            model="model",
            provider="ollama",
            thinking="reasoning",
        )

        self.assertEqual(AgentRunner._result_payload(result)["thinking"], "reasoning")


if __name__ == "__main__":
    unittest.main()

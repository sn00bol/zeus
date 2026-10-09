from __future__ import annotations

import asyncio
import sys
import unittest
from types import SimpleNamespace

from router.router import Router
from src.trace import TraceRecord, decode_trace, encode_trace
from src.browser_loop import BrowserLoop
from src.browser_obs import BrowserObservation, BrowserReference
from src.memory_provider import MemoryProvider
from src.process import ProcessSupervisor
from src.runner import StreamRunner


class StreamRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_continues_without_subscribers_and_replays_when_reconnected(self) -> None:
        runner = StreamRunner()
        release = asyncio.Event()
        started = asyncio.Event()

        async def work(publish: object) -> None:
            started.set()
            await release.wait()
            publish("delta", {"text": "hello"})
            publish("done", {"message": {"content": "hello"}})

        stream_id = runner.start("conversation-1", work)
        await started.wait()

        iterator = runner.events(stream_id)
        self.assertEqual((await anext(iterator)).event, "ui_control")
        waiting_for_event = asyncio.create_task(anext(iterator))
        await asyncio.sleep(0)
        waiting_for_event.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiting_for_event
        await iterator.aclose()

        release.set()
        replay = [item async for item in runner.events(stream_id)]
        self.assertEqual([item.event for item in replay], ["ui_control", "delta", "done"])
        self.assertEqual([item.event_id for item in replay], [1, 2, 3])
        await runner.stop()

    async def test_replay_buffer_is_bounded(self) -> None:
        runner = StreamRunner(max_events_per_stream=2)

        async def work(publish: object) -> None:
            publish("delta", {"text": "first"})
            publish("delta", {"text": "second"})
            publish("done", {"message": {"content": "complete"}})

        stream_id = runner.start("conversation-2", work)
        await asyncio.sleep(0)
        replay = [item async for item in runner.events(stream_id)]
        self.assertEqual([item.event for item in replay], ["delta", "done"])
        self.assertEqual([item.event_id for item in replay], [3, 4])
        await runner.stop()

class BrowserObservationTests(unittest.TestCase):
    def test_observation_deduplicates_and_bounds_reference_evidence(self) -> None:
        reference = BrowserReference("ref-1", "Example", "https://example.com")
        evidence = BrowserObservation.create(
            url="https://example.com",
            title="Example",
            text="x" * 20,
            references=[reference, reference],
            max_chars=10,
            max_references=4,
        )
        self.assertEqual(len(evidence.references), 1)
        self.assertEqual(evidence.text, "x" * 10)
        self.assertEqual(evidence.as_payload()["references"], [{
            "ref_id": "ref-1",
            "label": "Example",
            "href": "https://example.com",
        }])

    def test_trace_jsonl_round_trips(self) -> None:
        original = TraceRecord.create("trace-1", 0, "message", {"content": "hello"})
        self.assertEqual(decode_trace(encode_trace(original)), original)


class BrowserLoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_browser_loop_evicts_old_session_and_closes_owned_sessions(self) -> None:
        closed: list[str] = []

        class Session:
            def __init__(self, session_id: str) -> None:
                self.session_id = session_id

            async def close(self) -> None:
                closed.append(self.session_id)

        async def factory(session_id: str) -> Session:
            return Session(session_id)

        loop = BrowserLoop(factory, max_sessions=1)
        await loop.get("first")
        await loop.get("second")
        self.assertEqual(closed, ["first"])
        await loop.shutdown()
        self.assertEqual(closed, ["first", "second"])


class SupportingServicesTests(unittest.IsolatedAsyncioTestCase):
    async def test_memory_provider_uses_the_shared_memory_store(self) -> None:
        class Store:
            async def retrieve(self, **kwargs: object) -> list[str]:
                return ["relevant memory"]

        self.assertEqual(
            await MemoryProvider(Store()).recall(
                platform="webui",
                user_id="user-1",
                query="question",
            ),
            ["relevant memory"],
        )

    async def test_process_supervisor_stops_owned_child_processes(self) -> None:
        supervisor = ProcessSupervisor(terminate_timeout=1)
        child = await supervisor.start("short-lived", [sys.executable, "-c", "pass"])
        await child.process.wait()
        await supervisor.stop_all()
        self.assertEqual(child.process.returncode, 0)


class RouterStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_router_streams_deltas_and_collects_final_usage_without_buffering_chunks(self) -> None:
        from core.model import ModelContext

        class FakeProvider:
            name = "ollama"
            endpoint = SimpleNamespace(base_url="http://model")

        class FakeModelManager:
            async def resolve(self, request: object) -> ModelContext:
                return ModelContext(
                    provider_name="ollama",
                    provider=FakeProvider(),
                    model_name="test-model",
                    messages=[{"role": "user", "content": "hello"}],
                )

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            async def aiter_lines(self) -> object:
                for line in (
                    'data: {"model":"actual-model","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}',
                    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1}}',
                    "data: [DONE]",
                ):
                    yield line

        class StreamContext:
            async def __aenter__(self) -> FakeResponse:
                return FakeResponse()

            async def __aexit__(self, *args: object) -> None:
                return None

        class FakeClient:
            def __init__(self) -> None:
                self.call: tuple[object, ...] | None = None

            def stream(self, *args: object, **kwargs: object) -> StreamContext:
                self.call = (*args, kwargs)
                return StreamContext()

        router = Router(model_manager=FakeModelManager())
        client = FakeClient()

        async def get_client() -> FakeClient:
            return client

        router._get_client = get_client
        deltas: list[str] = []
        result = await router.route_stream(
            SimpleNamespace(
                messages=[],
                model=None,
                provider_name=None,
                stream=True,
                temperature=None,
                max_tokens=None,
                personality=None,
                platform="webui",
                extra={},
                session=None,
            ),
            lambda text: _append_delta(deltas, text),
        )

        self.assertEqual(deltas, ["Hi"])
        self.assertEqual(result.content, "Hi")
        self.assertEqual(result.model, "actual-model")
        self.assertEqual(result.prompt_tokens, 4)
        self.assertEqual(result.completion_tokens, 1)
        self.assertEqual(client.call[0], "POST")
        self.assertEqual(client.call[1], "http://model/v1/chat/completions")


async def _append_delta(deltas: list[str], text: str) -> None:
    deltas.append(text)

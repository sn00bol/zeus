import asyncio
import unittest
from unittest.mock import patch

from src import webui_bridge


def test_stream_disconnect_cancels_the_active_inference() -> None:
    async def run() -> None:
        inference_started = asyncio.Event()
        inference_cancelled = asyncio.Event()
        client_disconnected = asyncio.Event()

        async def route_stream(*_args, **_kwargs):
            inference_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                inference_cancelled.set()
                raise

        async def receive():
            await client_disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(_message):
            raise AssertionError("A disconnected client must not receive response data.")

        with patch.object(webui_bridge._router, "route_stream", route_stream):
            task = asyncio.create_task(
                webui_bridge._stream_inference(object(), receive, send),
            )
            await inference_started.wait()
            client_disconnected.set()
            await task

        assert inference_cancelled.is_set()

    asyncio.run(run())


def test_stream_task_cancellation_cancels_the_active_inference() -> None:
    async def run() -> None:
        inference_started = asyncio.Event()
        inference_cancelled = asyncio.Event()

        async def route_stream(*_args, **_kwargs):
            inference_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                inference_cancelled.set()
                raise

        async def receive():
            await asyncio.Future()

        async def send(_message):
            return None

        with patch.object(webui_bridge._router, "route_stream", route_stream):
            task = asyncio.create_task(
                webui_bridge._stream_inference(object(), receive, send),
            )
            await inference_started.wait()
            task.cancel()
            with unittest.TestCase().assertRaises(asyncio.CancelledError):
                await task

        assert inference_cancelled.is_set()

    asyncio.run(run())

from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from app import _RunLogRecorder, _is_visible_bridge_startup_log


class RunLogRecorderTests(unittest.TestCase):
    def test_only_bridge_startup_lines_are_shown_and_all_lines_are_saved(self) -> None:
        startup_line = "19:06:31 [bridge] INFO Application startup complete.\n"
        health_line = '19:06:32 [bridge] INFO 127.0.0.1:52332 - "GET /health HTTP/1.1" 200\n'
        poll_line = '19:06:33 [bridge] INFO 127.0.0.1:52334 - "GET /control/next HTTP/1.1" 200\n'
        self.assertTrue(_is_visible_bridge_startup_log(startup_line))
        self.assertTrue(_is_visible_bridge_startup_log(health_line))
        self.assertFalse(_is_visible_bridge_startup_log(poll_line))

        with tempfile.TemporaryDirectory() as temporary_directory:
            recorder = _RunLogRecorder(Path(temporary_directory))
            output = io.StringIO()
            with redirect_stdout(output):
                recorder.attach(
                    "bridge",
                    io.StringIO(startup_line + health_line + poll_line),
                    show_startup=True,
                )
                log_path = recorder.finish()

            self.assertEqual(output.getvalue(), startup_line + health_line)
            self.assertIn(poll_line.rstrip(), log_path.read_text(encoding="utf-8"))
            self.assertFalse(log_path.with_suffix(".log.tmp").exists())


if __name__ == "__main__":
    unittest.main()

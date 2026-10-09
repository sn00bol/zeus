from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

import app
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


class ManagedDatabaseTests(unittest.TestCase):
    def test_selected_platforms_always_include_webui_and_allow_one_bot(self) -> None:
        self.assertEqual(app._selected_platforms(""), ("webui",))
        self.assertEqual(app._selected_platforms("discord"), ("webui", "discord"))
        self.assertEqual(
            app._selected_platforms("webui,telegram"),
            ("webui", "telegram"),
        )
        with self.assertRaisesRegex(RuntimeError, "at most one"):
            app._selected_platforms("webui,discord,telegram")

    def test_webui_starts_its_node_runtime_without_reusing_a_platform_bridge(self) -> None:
        server = MagicMock()
        server.poll.return_value = None
        with (
            patch.dict("os.environ", {"WEBUI_PORT": "5001", "BRIDGE_PORT": "5000"}, clear=True),
            patch("app.subprocess.Popen", return_value=server) as popen,
            patch("app.urlopen") as urlopen,
        ):
            urlopen.return_value.__enter__.return_value.status = 200
            app._start_webui("node-test")

        self.assertEqual(popen.call_count, 1)
        self.assertEqual(
            popen.call_args.args[0],
            ["node-test", str(app.ROOT / "webui" / "app.js")],
        )
        urlopen.assert_called_once_with("http://127.0.0.1:5001/health", timeout=1)

    def test_container_managed_database_does_not_require_docker(self) -> None:
        environment = {
            "ZEUS_MANAGED_DATABASE": "true",
            "TELEGRAM_BOT_API_KEY": "test-token",
            "DB_PASSWORD": "test-password",
        }
        process = MagicMock()
        process.poll.return_value = None
        with (
            patch.dict("os.environ", environment, clear=True),
            patch("app.shutil.which", return_value="node") as which,
            patch("app.subprocess.Popen", return_value=process),
            patch("app.subprocess.run") as run,
            patch("app._wait_for_bridge"),
            patch("app._poll_control", side_effect=KeyboardInterrupt),
            patch("app._stop_process"),
        ):
            self.assertEqual(app.run_platform(name="telegram"), 0)

        which.assert_called_once_with("node")
        run.assert_not_called()

    def test_managed_database_allows_environment_without_dotenv_file(self) -> None:
        with (
            tempfile.TemporaryDirectory() as temporary_directory,
            patch.object(app, "ROOT", Path(temporary_directory)),
            patch.dict(
                "os.environ",
                {"ZEUS_MANAGED_DATABASE": "true", "PLATFORM": "telegram"},
                clear=True,
            ),
            patch("sys.argv", ["app.py"]),
            patch.object(app, "run_platform", return_value=0) as run_platform,
        ):
            self.assertEqual(app.main(), 0)

        run_platform.assert_called_once_with(
            name="telegram",
            record_logs=False,
            with_webui=True,
        )

    def test_webui_is_the_default_platform(self) -> None:
        with (
            tempfile.TemporaryDirectory() as temporary_directory,
            patch.object(app, "ROOT", Path(temporary_directory)),
            patch.dict(
                "os.environ",
                {"ZEUS_MANAGED_DATABASE": "true", "PLATFORM": "webui"},
                clear=True,
            ),
            patch("sys.argv", ["app.py"]),
            patch.object(app, "run_webui", return_value=0) as run_webui,
        ):
            self.assertEqual(app.main(), 0)

        run_webui.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()

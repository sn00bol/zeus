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
    def test_host_webui_starts_postgres_and_searxng(self) -> None:
        server = MagicMock()
        server.poll.return_value = None
        environment = {
            "DB_PASSWORD": "test-password",
            "SEARXNG_URL": "http://searxng:8080",
            "SEARXNG_PORT": "8889",
        }
        with (
            patch.dict("os.environ", environment, clear=True),
            patch(
                "app.shutil.which",
                side_effect=lambda name: {"docker": "docker-test", "node": "node-test"}.get(name),
            ),
            patch("app._require_docker_engine"),
            patch("app.subprocess.run") as run,
            patch("app._start_webui", return_value=server) as start_webui,
            patch("app.time.sleep", side_effect=KeyboardInterrupt),
            patch("app._stop_process"),
        ):
            self.assertEqual(app.run_webui(), 0)

        run.assert_called_once_with(
            ["docker-test", "compose", "up", "-d", "--wait", "postgres", "searxng"],
            cwd=app.ROOT,
            check=True,
        )
        self.assertEqual(
            start_webui.call_args.kwargs["environment"]["SEARXNG_URL"],
            "http://127.0.0.1:8889",
        )

    def test_host_environment_preserves_custom_searxng_url(self) -> None:
        with patch.dict(
            "os.environ",
            {"SEARXNG_URL": "https://search.example.test"},
            clear=True,
        ):
            environment = app._host_environment()

        self.assertEqual(environment["SEARXNG_URL"], "https://search.example.test")

    def test_selected_platforms_always_include_webui_and_allow_both_bots(self) -> None:
        self.assertEqual(app._selected_platforms(""), ("webui",))
        self.assertEqual(app._selected_platforms("discord"), ("webui", "discord"))
        self.assertEqual(
            app._selected_platforms("webui,telegram"),
            ("webui", "telegram"),
        )
        self.assertEqual(
            app._selected_platforms("telegram,webui,discord,telegram"),
            ("webui", "discord", "telegram"),
        )

    def test_control_poll_returns_action_and_target_platform(self) -> None:
        response = MagicMock()
        response.status = 200
        response.read.return_value = b'{"action":"restart","platform":"telegram"}'
        with patch("app.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value = response
            self.assertEqual(app._poll_control(5000), ("restart", "telegram"))

    def test_run_platforms_starts_one_bridge_and_each_bot_with_webui(self) -> None:
        process = MagicMock()
        process.poll.return_value = None
        environment = {
            "ZEUS_MANAGED_DATABASE": "true",
            "DISCORD_BOT_API_KEY": "discord-token",
            "TELEGRAM_BOT_API_KEY": "telegram-token",
            "PFX": "!",
            "DB_PASSWORD": "test-password",
        }
        with (
            patch.dict("os.environ", environment, clear=True),
            patch("app.shutil.which", return_value="node"),
            patch("app.subprocess.Popen", return_value=process) as popen,
            patch("app._wait_for_bridge"),
            patch("app._start_webui", return_value=process),
            patch("app._poll_control", side_effect=KeyboardInterrupt),
            patch("app._stop_process"),
        ):
            self.assertEqual(
                app.run_platforms(names=("discord", "telegram"), with_webui=True),
                0,
            )

        self.assertEqual(popen.call_count, 3)
        self.assertEqual(
            popen.call_args_list[0].args[0],
            [app.sys.executable, "-m", "src.discord_bridge"],
        )
        self.assertEqual(
            [call.args[0][-1] for call in popen.call_args_list[1:]],
            [
                str(app.ROOT / "platform" / "discord" / "index.js"),
                str(app.ROOT / "platform" / "telegram" / "index.js"),
            ],
        )
        self.assertEqual(
            [call.kwargs["env"]["PLATFORM"] for call in popen.call_args_list[1:]],
            ["discord", "telegram"],
        )
        self.assertNotEqual(
            popen.call_args_list[1].kwargs["env"]["HEALTHCHECK_PORT"],
            popen.call_args_list[2].kwargs["env"]["HEALTHCHECK_PORT"],
        )

    def test_restart_control_restarts_only_the_requested_bot(self) -> None:
        process = MagicMock()
        process.poll.return_value = None
        environment = {
            "ZEUS_MANAGED_DATABASE": "true",
            "DISCORD_BOT_API_KEY": "discord-token",
            "TELEGRAM_BOT_API_KEY": "telegram-token",
            "PFX": "!",
            "DB_PASSWORD": "test-password",
        }
        with (
            patch.dict("os.environ", environment, clear=True),
            patch("app.shutil.which", return_value="node"),
            patch("app.subprocess.Popen", return_value=process) as popen,
            patch("app._wait_for_bridge"),
            patch("app._wait_for_exit", return_value=True),
            patch(
                "app._poll_control",
                side_effect=[("restart", "telegram"), KeyboardInterrupt],
            ),
            patch("app._stop_process"),
        ):
            self.assertEqual(app.run_platforms(names=("discord", "telegram")), 0)

        self.assertEqual(popen.call_count, 4)
        self.assertEqual(
            popen.call_args_list[3].args[0],
            popen.call_args_list[2].args[0],
        )

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
            patch.object(app, "run_platforms", return_value=0) as run_platforms,
        ):
            self.assertEqual(app.main(), 0)

        run_platforms.assert_called_once_with(
            names=("telegram",),
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

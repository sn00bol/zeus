from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import AsyncMock, patch

import setup


class _TTYStringIO(io.StringIO):
    def isatty(self) -> bool:
        return True


class SetupSelectionTests(unittest.TestCase):
    def test_update_env_removes_legacy_platform_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            env_path = Path(temporary_directory) / ".env"
            env_path.write_text("PLATFORM=webui,discord\nDB_PASSWORD=secret\n", encoding="utf-8")

            setup.update_env(env_path, {"DB_PASSWORD": "updated"}, remove_keys={"PLATFORM"})

            contents = env_path.read_text(encoding="utf-8")
            self.assertNotIn("PLATFORM=", contents)
            self.assertIn("DB_PASSWORD=updated", contents)

    def test_platform_selection_is_persisted_to_database(self) -> None:
        connection = AsyncMock()
        config = {
            "DB_HOST": "127.0.0.1",
            "DB_PORT": "5432",
            "DB_NAME": "zeus",
            "DB_USER": "zeus",
            "DB_PASSWORD": "test-password",
        }
        with patch("asyncpg.connect", new=AsyncMock(return_value=connection)) as connect:
            setup.save_platform_settings(setup.ROOT, "webui,telegram", config)

        connect.assert_awaited_once()
        connection.execute.assert_awaited_once()
        self.assertEqual(
            connection.executemany.await_args.args[1],
            [("webui", True), ("discord", False), ("telegram", True)],
        )
        connection.close.assert_awaited_once()

    def test_arrow_keys_move_the_interactive_selection(self) -> None:
        output = _TTYStringIO()
        options = [("discord", "Discord"), ("telegram", "Telegram")]
        with (
            patch.object(setup.sys, "stdin", _TTYStringIO()),
            patch.object(setup.sys, "stdout", output),
            patch.object(setup, "_read_menu_key", side_effect=["down", "enter"]),
        ):
            selected = setup._choose_option("Platform", options, "discord")

        self.assertEqual(selected, "telegram")

    def test_provider_selection_accepts_provider_name(self) -> None:
        self.assertEqual(
            setup.choose_provider(lambda _: "llamacpp", "ollama"),
            "llamacpp",
        )

    def test_platform_selection_accepts_number(self) -> None:
        self.assertEqual(setup.choose_platform(lambda _: "2"), "webui,discord")

    def test_platform_selection_allows_both_bots(self) -> None:
        self.assertEqual(setup.choose_platform(lambda _: ""), "webui")
        self.assertEqual(setup.choose_platform(lambda _: "3"), "webui,telegram")
        self.assertEqual(setup.choose_platform(lambda _: "4"), "webui,discord,telegram")
        self.assertEqual(
            setup._normalize_platform_selection("discord"),
            "webui,discord",
        )
        self.assertEqual(
            setup._normalize_platform_selection("telegram,webui,discord,telegram"),
            "webui,discord,telegram",
        )

    def test_interactive_platform_menu_can_toggle_both_bots(self) -> None:
        with (
            patch.object(setup.sys, "stdin", _TTYStringIO()),
            patch.object(setup.sys, "stdout", _TTYStringIO()),
            patch.object(
                setup,
                "_read_menu_key",
                side_effect=["down", "space", "down", "space", "enter"],
            ),
        ):
            selected = setup.choose_platform(current_platform="webui")

        self.assertEqual(selected, "webui,discord,telegram")

    def test_model_selection_can_choose_automatic(self) -> None:
        with patch.object(setup, "discover_models", return_value=["gemma4:31b-cloud"]):
            with redirect_stdout(io.StringIO()):
                selected = setup.choose_model(
                    "ollama",
                    "localhost",
                    11434,
                    input_fn=lambda _: "2",
                )

        self.assertEqual(selected, "")

    def test_ollama_model_discovery(self) -> None:
        response = io.BytesIO(json.dumps({
            "models": [{"name": "gemma4:31b-cloud"}, {"name": "qwen3"}],
        }).encode())
        with patch.object(setup.urllib.request, "urlopen", return_value=response) as urlopen:
            models = setup.discover_models("ollama", "localhost", 11434)

        self.assertEqual(models, ["gemma4:31b-cloud", "qwen3"])
        self.assertEqual(urlopen.call_args.args[0].full_url, "http://localhost:11434/api/tags")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import setup


class _TTYStringIO(io.StringIO):
    def isatty(self) -> bool:
        return True


class SetupSelectionTests(unittest.TestCase):
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

    def test_webui_is_default_and_bot_platforms_are_mutually_exclusive(self) -> None:
        self.assertEqual(setup.choose_platform(lambda _: ""), "webui")
        self.assertEqual(setup.choose_platform(lambda _: "3"), "webui,telegram")
        self.assertEqual(
            setup._normalize_platform_selection("discord"),
            "webui,discord",
        )
        with self.assertRaisesRegex(ValueError, "at most one"):
            setup._normalize_platform_selection("webui,discord,telegram")

    def test_interactive_platform_menu_toggles_optional_platform(self) -> None:
        with (
            patch.object(setup.sys, "stdin", _TTYStringIO()),
            patch.object(setup.sys, "stdout", _TTYStringIO()),
            patch.object(setup, "_read_menu_key", side_effect=["down", "space", "enter"]),
        ):
            selected = setup.choose_platform(current_platform="webui")

        self.assertEqual(selected, "webui,telegram")

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

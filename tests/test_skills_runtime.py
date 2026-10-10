from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.skills.conversation import ConversationComposer, compose_system_message
from src.skills import runtime as skills_runtime
from src.skills.runtime import (
    SkillLoader,
    SkillRegistry,
    SkillRuntime,
    SkillSelector,
    analyze_prompt,
    parse_skill_markdown,
    tokenize,
)
from src.skills.types import SkillSpec


_HTTP_MARKERS = ("httpx", "requests.get", "urllib", "def fetch", "aiohttp")


class SkillRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = SkillRuntime()

    def test_loader_reads_core_and_research_catalog(self) -> None:
        loader = SkillLoader()
        core = loader.load_core()
        catalog = loader.load_catalog()

        self.assertIn("You are ZEUS", core.soul)
        self.assertIn("Skills describe process", core.safety)
        self.assertIn("The user never selects a skill", core.skill)
        slugs = {skill.slug for skill in catalog}
        self.assertIn("research", slugs)

    def test_parse_skill_uses_headings_not_mode_syntax(self) -> None:
        text = (
            "# Example Skill\n\n"
            "A short description of the task.\n\n"
            "## When to use\n"
            "Use when the user asks for an example.\n\n"
            "## Process\n"
            "1. Do the work.\n"
        )
        skill = parse_skill_markdown(text, Path("example_skill.md"))
        self.assertEqual(skill.name, "Example Skill")
        self.assertEqual(skill.slug, "example_skill")
        self.assertIn("short description", skill.description)
        self.assertIn("asks for an example", skill.when_to_use)

    def test_selector_attaches_research_for_source_questions(self) -> None:
        selected = self.runtime.select(
            "Please research Napoleon and evaluate sources with citations."
        )
        self.assertEqual([skill.slug for skill in selected], ["research"])

    def test_selector_skips_ordinary_chat(self) -> None:
        selected = self.runtime.select("hello, how are you today?")
        self.assertEqual(selected, [])

    def test_prompt_analysis_does_not_use_a_stopword_list(self) -> None:
        self.assertFalse(hasattr(skills_runtime, "_STOPWORDS"))
        self.assertIn("research", analyze_prompt("Please research Napoleon and evaluate sources."))
        self.assertIn("napoleon", tokenize("Please research Napoleon."))

    def test_composer_always_includes_soul_safety_and_skill_workflow(self) -> None:
        message = compose_system_message("hello, how are you today?", runtime=self.runtime)
        content = message["content"]
        self.assertEqual(message["role"], "system")
        self.assertIn("You are ZEUS", content)
        self.assertIn("# Safety", content)
        self.assertIn("# Skill workflow", content)
        self.assertNotIn("# Active skill: Research", content)

    def test_composer_includes_research_body_when_selected(self) -> None:
        message = compose_system_message(
            "Need a literature overview and source evaluation for climate reports.",
            runtime=self.runtime,
        )
        self.assertIn("# Active skill: Research", message["content"])
        self.assertIn("## Process", message["content"])

    def test_research_skill_has_no_http_execution_logic(self) -> None:
        research = self.runtime.registry.get("research")
        self.assertIsNotNone(research)
        assert research is not None
        lowered = research.body.lower()
        for marker in _HTTP_MARKERS:
            self.assertNotIn(marker, lowered)
        self.assertIn("belong to tools or runtime", research.body)

    def test_selector_respects_top_k_and_threshold(self) -> None:
        skills = [
            _spec("alpha", "alpha work", "use for alpha tasks"),
            _spec("beta", "beta work", "use for beta tasks"),
        ]
        selector = SkillSelector(SkillRegistry(skills), top_k=1, min_score=0.1)
        selected = selector.select("please help with alpha work")
        self.assertEqual([skill.slug for skill in selected], ["alpha"])
        skipped = selector.select("please help with this")
        self.assertEqual(skipped, [])

    def test_loader_requires_core_files(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            loader = SkillLoader(Path(raw_dir))
            with self.assertRaises(FileNotFoundError):
                loader.load_core()

    def test_conversation_composer_joins_selected_skills(self) -> None:
        composer = ConversationComposer(self.runtime.core)
        research = self.runtime.registry.get("research")
        assert research is not None
        content = composer.build_system_content([research])
        self.assertLess(content.index("You are ZEUS"), content.index("# Safety"))
        self.assertLess(content.index("# Safety"), content.index("# Skill workflow"))
        self.assertLess(content.index("# Skill workflow"), content.index("# Active skill: Research"))


def _spec(slug: str, description: str, when_to_use: str) -> SkillSpec:
    return SkillSpec(
        name=slug.title(),
        slug=slug,
        description=description,
        when_to_use=when_to_use,
        body=f"# {slug.title()}\n\n{description}\n",
        path=Path(f"{slug}.md"),
    )


if __name__ == "__main__":
    unittest.main()

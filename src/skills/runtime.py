"""Skill loader, registry, selector, and runtime facade."""

from __future__ import annotations

import math
import re
from pathlib import Path

from .types import CoreDocuments, SkillSpec

SKILLS_DIR = Path(__file__).resolve().parent
CATALOG_DIRNAME = "catalog"
CORE_FILES = {
    "soul": "SOUL.md",
    "safety": "SAFETY.md",
    "skill": "SKILL.md",
}

_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)


def tokenize(text: str) -> set[str]:
    """Return content tokens extracted from *text*."""
    tokens: set[str] = set()
    for match in _TOKEN_RE.finditer(text):
        token = _fold_token(match.group(0).casefold())
        if len(token) > 1:
            tokens.add(token)
    return tokens


def analyze_prompt(text: str, vocabulary: set[str] | None = None) -> set[str]:
    """Keep prompt tokens that carry meaning against an optional vocabulary."""
    tokens = tokenize(text)
    if vocabulary is None:
        return tokens
    return tokens & vocabulary


def _fold_token(token: str) -> str:
    if token.isascii() and len(token) > 4 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _skill_search_text(skill: SkillSpec) -> str:
    return f"{skill.name}\n{skill.description}\n{skill.when_to_use}"


def _distinctive_tokens(skill_token_sets: list[set[str]]) -> set[str]:
    """Drop filler words that appear in almost every skill, inferred from the catalog."""
    if not skill_token_sets:
        return set()
    catalog = set().union(*skill_token_sets)
    count = len(skill_token_sets)
    if count < 2:
        return catalog
    document_frequency: dict[str, int] = {}
    for tokens in skill_token_sets:
        for token in tokens:
            document_frequency[token] = document_frequency.get(token, 0) + 1
    ceiling = max(2, math.ceil(count * 0.8))
    return {token for token, seen in document_frequency.items() if seen < ceiling}


def parse_skill_markdown(text: str, path: Path) -> SkillSpec:
    """Parse a catalog skill from ordinary markdown headings."""
    name = path.stem.replace("_", " ").strip() or path.stem
    lead: list[str] = []
    when_lines: list[str] = []
    section: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if line.startswith("# "):
            heading = line[2:].strip()
            if heading:
                name = heading
            section = "lead"
            continue
        if line.startswith("## "):
            heading = line[3:].strip().lower()
            section = "when" if heading == "when to use" else "other"
            continue
        stripped = line.strip()
        if not stripped:
            if section == "lead" and lead:
                section = "lead_done"
            continue
        if section == "lead":
            lead.append(stripped)
        elif section == "when":
            when_lines.append(stripped)

    return SkillSpec(
        name=name,
        slug=path.stem.lower(),
        description=" ".join(lead),
        when_to_use="\n".join(when_lines),
        body=text.strip(),
        path=path,
    )


class SkillLoader:
    """Read core instruction files and catalog skills from disk."""

    def __init__(self, skills_dir: Path | None = None) -> None:
        self.skills_dir = skills_dir or SKILLS_DIR

    def load_core(self) -> CoreDocuments:
        return CoreDocuments(
            soul=self._read_required(CORE_FILES["soul"]),
            safety=self._read_required(CORE_FILES["safety"]),
            skill=self._read_required(CORE_FILES["skill"]),
        )

    def load_catalog(self) -> list[SkillSpec]:
        catalog_dir = self.skills_dir / CATALOG_DIRNAME
        if not catalog_dir.is_dir():
            return []
        skills: list[SkillSpec] = []
        for path in sorted(catalog_dir.glob("*.md")):
            skills.append(parse_skill_markdown(path.read_text(encoding="utf-8"), path))
        return skills

    def _read_required(self, filename: str) -> str:
        path = self.skills_dir / filename
        if not path.is_file():
            raise FileNotFoundError(f"Required skill file is missing: {path}")
        return path.read_text(encoding="utf-8").strip()


class SkillRegistry:
    """In-memory catalog of selectable skills."""

    def __init__(self, skills: list[SkillSpec] | None = None) -> None:
        self._skills = list(skills or [])
        self._by_slug = {skill.slug: skill for skill in self._skills}

    def all(self) -> list[SkillSpec]:
        return list(self._skills)

    def get(self, slug: str) -> SkillSpec | None:
        return self._by_slug.get(slug.lower())


class SkillSelector:
    """Pick catalog skills by analyzing the latest user prompt."""

    def __init__(
        self,
        registry: SkillRegistry,
        *,
        top_k: int = 2,
        min_score: float = 0.15,
    ) -> None:
        if top_k < 1:
            raise ValueError("top_k must be at least 1.")
        self._registry = registry
        self._top_k = top_k
        self._min_score = min_score
        self._skill_tokens = [
            (skill, tokenize(_skill_search_text(skill)))
            for skill in registry.all()
        ]
        self._prompt_vocabulary = _distinctive_tokens(
            [tokens for _, tokens in self._skill_tokens]
        )

    def select(self, query: str) -> list[SkillSpec]:
        prompt_tokens = analyze_prompt(query, self._prompt_vocabulary)
        if not prompt_tokens:
            return []

        ranked: list[tuple[float, SkillSpec]] = []
        for skill, skill_tokens in self._skill_tokens:
            score = self._score(query, prompt_tokens, skill, skill_tokens)
            if score >= self._min_score:
                ranked.append((score, skill))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [skill for _, skill in ranked[: self._top_k]]

    def _score(
        self,
        query: str,
        prompt_tokens: set[str],
        skill: SkillSpec,
        skill_tokens: set[str],
    ) -> float:
        if not skill_tokens:
            return 0.0
        overlap = prompt_tokens & skill_tokens
        if not overlap:
            score = 0.0
        else:
            score = len(overlap) / len(prompt_tokens)
        lowered = query.casefold()
        if skill.slug in prompt_tokens or skill.name.casefold() in lowered:
            score += 0.5
        return score


class SkillRuntime:
    """Load skills once and select relevant documents for each turn."""

    def __init__(
        self,
        skills_dir: Path | None = None,
        *,
        top_k: int = 2,
        min_score: float = 0.15,
        loader: SkillLoader | None = None,
        registry: SkillRegistry | None = None,
        selector: SkillSelector | None = None,
        core: CoreDocuments | None = None,
    ) -> None:
        self._loader = loader or SkillLoader(skills_dir)
        self.core = core or self._loader.load_core()
        self.registry = registry or SkillRegistry(self._loader.load_catalog())
        self.selector = selector or SkillSelector(
            self.registry,
            top_k=top_k,
            min_score=min_score,
        )

    def select(self, query: str, recent: str = "") -> list[SkillSpec]:
        combined = "\n".join(part for part in (recent, query) if part and part.strip())
        return self.selector.select(combined)

"""Bounded, deterministic query planning with outcome-based adaptation."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .quality import SearchQuality

_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)


@dataclass(frozen=True)
class SearchPlan:
    mode: str
    follow_up_query: str | None = None


class SearchPlanner:
    def plan(
        self,
        query: str,
        quality: SearchQuality,
        *,
        max_query_variants: int = 1,
        quality_threshold: float = 0.45,
        max_query_length: int = 2_000,
    ) -> SearchPlan:
        if not 0 <= quality_threshold <= 1:
            raise ValueError("Search quality threshold must be between zero and one.")
        if max_query_variants <= 0 or quality.score >= quality_threshold:
            return SearchPlan(mode="fast")
        terms = [term for term in _TOKEN.findall(query) if len(term) > 2]
        focused = " ".join(terms[:8])[:max_query_length].strip()
        if not focused or focused.casefold() == query.strip().casefold():
            return SearchPlan(mode="fast")
        return SearchPlan(mode="adaptive", follow_up_query=focused)

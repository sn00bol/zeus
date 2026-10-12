"""Quality signals for deciding whether an additional retrieval pass is useful."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .ranker import ResultRanker, SearchResultLike, _terms


@dataclass(frozen=True)
class SearchQuality:
    score: float
    result_count: int
    query_coverage: float


def evaluate_quality(query: str, results: Sequence[SearchResultLike]) -> SearchQuality:
    if not results:
        return SearchQuality(score=0.0, result_count=0, query_coverage=0.0)
    ranker = ResultRanker()
    terms = _terms(query)
    found = set().union(*(_terms(item.title) | _terms(item.content) for item in results))
    coverage = len(terms & found) / len(terms) if terms else 0.0
    best_result = max(ranker.score(query, item) for item in results)
    breadth = min(len(results) / 3, 1.0)
    score = min(1.0, 0.55 * best_result + 0.30 * coverage + 0.15 * breadth)
    return SearchQuality(score, len(results), coverage)

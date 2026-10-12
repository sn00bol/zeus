"""Multi-signal result scoring and ranking combining lexical matching, authority, and freshness."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Protocol, Sequence, TypeVar
from urllib.parse import urlsplit

_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)

_AUTHORITY_DOMAINS = frozenset({
    "github.com",
    "docs.python.org",
    "wikipedia.org",
    "developer.mozilla.org",
    "stackoverflow.com",
    "arxiv.org",
    "w3.org",
})


class SearchResultLike(Protocol):
    title: str
    url: str
    content: str


ResultT = TypeVar("ResultT", bound=SearchResultLike)


class ResultRanker:
    """Multi-signal result ranker with phrase matching, domain authority, and freshness heuristics."""

    def __init__(
        self,
        *,
        title_weight: float = 0.55,
        body_weight: float = 0.25,
        phrase_weight: float = 0.10,
        authority_weight: float = 0.10,
    ) -> None:
        self.title_weight = title_weight
        self.body_weight = body_weight
        self.phrase_weight = phrase_weight
        self.authority_weight = authority_weight

    def score(
        self,
        query: str,
        result: SearchResultLike,
        *,
        semantic_score: float | None = None,
    ) -> float:
        terms = _terms(query)
        if not terms:
            return 0.0

        title = getattr(result, "title", "") or ""
        body = getattr(result, "content", "") or ""
        url = getattr(result, "url", "") or ""

        title_terms = _terms(title)
        body_terms = _terms(body)

        title_coverage = len(terms & title_terms) / len(terms)
        body_coverage = len(terms & body_terms) / len(terms)

        # Exact phrase bonus
        clean_q = query.strip().casefold()
        phrase_bonus = 0.0
        if len(clean_q) > 4:
            if clean_q in title.casefold():
                phrase_bonus = 1.0
            elif clean_q in body.casefold():
                phrase_bonus = 0.5

        # Domain authority bonus
        authority_bonus = 0.0
        try:
            host = urlsplit(url).hostname or ""
            if any(host == dom or host.endswith(f".{dom}") for dom in _AUTHORITY_DOMAINS):
                authority_bonus = 0.8
            elif host.startswith("docs.") or ".edu" in host or ".gov" in host:
                authority_bonus = 0.9
        except Exception:
            pass

        # Freshness bonus if published_date is present
        freshness_bonus = 0.0
        pub_date = getattr(result, "published_date", "") or ""
        if pub_date:
            freshness_bonus = _calculate_freshness_boost(pub_date)

        lexical_score = (
            self.title_weight * title_coverage
            + self.body_weight * body_coverage
            + self.phrase_weight * phrase_bonus
            + self.authority_weight * authority_bonus
            + 0.05 * freshness_bonus
        )

        if semantic_score is not None:
            # Combine lexical with semantic (60% lexical, 40% semantic)
            final = 0.60 * lexical_score + 0.40 * min(1.0, max(0.0, semantic_score))
        else:
            final = lexical_score

        return min(1.0, max(0.0, final))

    def rank(
        self,
        query: str,
        results: Sequence[ResultT],
        *,
        semantic_scores: dict[str, float] | None = None,
    ) -> list[ResultT]:
        indexed = list(enumerate(results))

        def _sort_key(item: tuple[int, ResultT]) -> tuple[float, int, str]:
            idx, res = item
            sem_score = semantic_scores.get(res.url) if semantic_scores else None
            score = self.score(query, res, semantic_score=sem_score)
            return (-score, idx, getattr(res, "url", ""))

        indexed.sort(key=_sort_key)
        return [result for _, result in indexed]


def _terms(text: str) -> set[str]:
    return {term.casefold() for term in _TOKEN.findall(text) if len(term) > 1}


def _calculate_freshness_boost(date_str: str) -> float:
    try:
        # Check ISO format YYYY-MM-DD
        dt = datetime.fromisoformat(date_str[:10]).replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        days_old = max(0, (now - dt).days)
        if days_old <= 30:
            return 1.0
        if days_old <= 180:
            return 0.5
        if days_old <= 365:
            return 0.2
    except Exception:
        pass
    return 0.0

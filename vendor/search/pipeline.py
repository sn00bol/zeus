"""Small retrieval orchestrator that escalates only after weak first-pass results."""

from __future__ import annotations

import asyncio
from typing import Generic, Protocol, TypeVar

from .config import SearchConfig
from .filter import ResultFilter
from .planner import SearchPlanner
from .quality import SearchQuality, evaluate_quality
from .ranker import ResultRanker, SearchResultLike


ResultT = TypeVar("ResultT", bound=SearchResultLike)


class SearchBackend(Protocol[ResultT]):
    async def search(self, query: str, *, limit: int = 6) -> list[ResultT]: ...


class SearchPipeline(Generic[ResultT]):
    def __init__(
        self,
        backend: SearchBackend[ResultT],
        *,
        config: SearchConfig | None = None,
        result_filter: ResultFilter | None = None,
        planner: SearchPlanner | None = None,
        ranker: ResultRanker | None = None,
    ) -> None:
        self.config = config or SearchConfig()
        self._backend = backend
        self._filter = result_filter or ResultFilter()
        self._planner = planner or SearchPlanner()
        self._ranker = ranker or ResultRanker()

    async def search(self, query: str) -> tuple[list[ResultT], SearchQuality]:
        normalized = query.strip()
        if not normalized:
            return [], evaluate_quality("", [])
        if len(normalized) > self.config.max_query_length:
            raise ValueError("Search query exceeds the configured length limit.")
        return await asyncio.wait_for(
            self._search(normalized),
            timeout=self.config.timeout_seconds,
        )

    async def _search(self, normalized: str) -> tuple[list[ResultT], SearchQuality]:
        initial = self._filter.filter(
            await self._backend.search(normalized, limit=self.config.max_results)
        )
        quality = evaluate_quality(normalized, initial)
        plan = self._planner.plan(
            normalized,
            quality,
            max_query_variants=self.config.max_query_variants,
            quality_threshold=self.config.quality_threshold,
            max_query_length=self.config.max_query_length,
        )
        results = initial
        if plan.follow_up_query is not None:
            follow_up = self._filter.filter(
                await self._backend.search(
                    plan.follow_up_query,
                    limit=self.config.max_results,
                )
            )
            by_url = {result.url: result for result in (*initial, *follow_up)}
            results = list(by_url.values())
            quality = evaluate_quality(normalized, results)
        ranked = self._ranker.rank(normalized, results)
        return ranked[: self.config.max_results], quality

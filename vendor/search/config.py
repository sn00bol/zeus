"""Resolved resource and feature limits for retrieval components."""

from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar


@dataclass(frozen=True)
class SearchConfig:
    MAX_RESULTS: ClassVar[int] = 12

    max_results: int = 10
    max_query_variants: int = 1
    quality_threshold: float = 0.45
    max_query_length: int = 2_000
    vector_top_k: int = 10
    max_vectors: int = 50_000
    timeout_seconds: float = 20.0
    semantic_enabled: bool = False

    def __post_init__(self) -> None:
        if not 1 <= self.max_results <= self.MAX_RESULTS or self.max_query_variants < 0:
            raise ValueError("Search result and query-variant limits are invalid.")
        if self.max_query_length < 1 or self.vector_top_k < 1 or self.max_vectors < 1:
            raise ValueError("Search resource limits must be positive.")
        if self.timeout_seconds <= 0:
            raise ValueError("Search timeout must be positive.")
        if not 0 <= self.quality_threshold <= 1:
            raise ValueError("Search quality threshold must be between zero and one.")

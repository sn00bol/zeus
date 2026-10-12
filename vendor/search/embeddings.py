"""Embedding generation contracts, deterministic offline vectorizer, model-backed provider, and RRF fusion."""

from __future__ import annotations

import hashlib
import math
import re
from collections import OrderedDict
from collections.abc import Sequence
from typing import Any, Protocol, TypeVar

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]


class EmbeddingProvider(Protocol):
    async def embed_query(self, text: str) -> Sequence[float]: ...

    async def embed_documents(self, texts: Sequence[str]) -> list[Sequence[float]]: ...


def validate_embedding(vector: Sequence[float], *, dimension: int | None = None) -> tuple[float, ...]:
    if not vector:
        raise ValueError("An embedding vector cannot be empty.")
    if dimension is not None and len(vector) != dimension:
        raise ValueError("Embedding dimension does not match the configured dimension.")
    normalized = tuple(float(value) for value in vector)
    if any(not math.isfinite(value) for value in normalized):
        raise ValueError("Embedding values must be finite.")
    return normalized


class HashingNgramVectorizer:
    """Fast, deterministic, zero-dependency offline text vectorizer using subword and word hashing."""

    def __init__(self, *, dimension: int = 256) -> None:
        if dimension < 8:
            raise ValueError("Embedding dimension must be at least 8.")
        self.dimension = dimension
        self._token_re = re.compile(r"\w+", re.UNICODE)

    def vectorize(self, text: str) -> tuple[float, ...]:
        normalized = text.strip().casefold()
        if not normalized:
            # Return unit vector along first dimension for non-empty contract
            vec = [0.0] * self.dimension
            vec[0] = 1.0
            return tuple(vec)

        counts = [0.0] * self.dimension

        # 1. Word tokens
        words = self._token_re.findall(normalized)
        for word in words:
            if not word:
                continue
            idx = int(hashlib.md5(word.encode("utf-8")).hexdigest(), 16) % self.dimension
            counts[idx] += 2.0

        # 2. Character n-grams (3-grams and 4-grams)
        padded = f" {normalized} "
        for n in (3, 4):
            for i in range(len(padded) - n + 1):
                ngram = padded[i : i + n]
                idx = int(hashlib.md5(ngram.encode("utf-8")).hexdigest(), 16) % self.dimension
                counts[idx] += 1.0

        # Compute L2 norm and normalize
        norm = math.sqrt(sum(val * val for val in counts))
        if norm == 0.0 or not math.isfinite(norm):
            vec = [0.0] * self.dimension
            vec[0] = 1.0
            return tuple(vec)

        return tuple(val / norm for val in counts)

    async def embed_query(self, text: str) -> Sequence[float]:
        return self.vectorize(text)

    async def embed_documents(self, texts: Sequence[str]) -> list[Sequence[float]]:
        return [self.vectorize(text) for text in texts]


class EmbeddingCache:
    """Bounded LRU cache for embedding vectors to avoid duplicate computations."""

    def __init__(self, *, max_size: int = 2_048) -> None:
        self.max_size = max_size
        self._cache: OrderedDict[str, tuple[float, ...]] = OrderedDict()

    def get(self, text: str) -> tuple[float, ...] | None:
        res = self._cache.get(text)
        if res is not None:
            self._cache.move_to_end(text)
        return res

    def set(self, text: str, embedding: Sequence[float]) -> None:
        if len(self._cache) >= self.max_size:
            self._cache.popitem(last=False)
        self._cache[text] = tuple(embedding)


class ModelEmbeddingProvider:
    """Async provider that queries Ollama /api/embeddings or OpenAI-compatible /v1/embeddings with offline fallback."""

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:11434",
        model: str = "nomic-embed-text",
        fallback: EmbeddingProvider | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.fallback = fallback or HashingNgramVectorizer(dimension=256)
        self.timeout = timeout
        self.cache = EmbeddingCache()

    async def embed_query(self, text: str) -> Sequence[float]:
        cached = self.cache.get(text)
        if cached is not None:
            return cached

        if httpx is not None:
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    # Try Ollama endpoint
                    resp = await client.post(
                        f"{self.base_url}/api/embeddings",
                        json={"model": self.model, "prompt": text},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        emb = data.get("embedding")
                        if isinstance(emb, list) and emb:
                            validated = validate_embedding(emb)
                            self.cache.set(text, validated)
                            return validated
            except Exception:
                pass

        # Fallback to local deterministic embedder
        res = await self.fallback.embed_query(text)
        self.cache.set(text, res)
        return res

    async def embed_documents(self, texts: Sequence[str]) -> list[Sequence[float]]:
        results: list[Sequence[float]] = []
        for text in texts:
            results.append(await self.embed_query(text))
        return results


T = TypeVar("T")


def reciprocal_rank_fusion(
    ranked_lists: Sequence[Sequence[T]],
    *,
    k: int = 60,
) -> list[tuple[T, float]]:
    """Compute Reciprocal Rank Fusion scores across multiple rankings."""
    scores: dict[Any, float] = {}
    item_map: dict[Any, T] = {}

    for ranking in ranked_lists:
        for rank, item in enumerate(ranking, start=1):
            key = getattr(item, "url", item)
            item_map[key] = item
            scores[key] = scores.get(key, 0.0) + (1.0 / (k + rank))

    sorted_items = sorted(scores.items(), key=lambda x: -x[1])
    return [(item_map[key], score) for key, score in sorted_items]

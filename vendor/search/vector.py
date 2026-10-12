"""Bounded in-memory cosine index with pre-allocated buffer and fast top-k retrieval."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .embeddings import validate_embedding


class VectorRecord:
    """A record stored in the vector index with ID, embedding, and metadata."""

    def __init__(self, doc_id: str, embedding: Sequence[float], metadata: dict[str, Any] | None = None) -> None:
        self.doc_id = doc_id
        self.embedding = tuple(embedding)
        self.metadata = dict(metadata or {})


class VectorIndex:
    """High-performance in-memory cosine vector index with dynamic buffer growth and metadata payload."""

    def __init__(self, *, max_vectors: int = 50_000, initial_capacity: int = 64) -> None:
        if max_vectors < 1:
            raise ValueError("Vector index capacity must be positive.")
        try:
            import numpy as np
        except ImportError as exc:
            raise RuntimeError(
                "Vector search requires the optional 'search' extra (NumPy)."
            ) from exc

        self._np = np
        self._max_vectors = max_vectors
        self._initial_capacity = min(max_vectors, max(16, initial_capacity))
        self._ids: list[str] = []
        self._id_to_idx: dict[str, int] = {}
        self._metadata: list[dict[str, Any]] = []
        self._matrix = np.empty((0, 0), dtype=np.float32)
        self._dimension: int | None = None
        self._capacity = 0
        self._count = 0

    def _ensure_capacity(self, needed: int = 1) -> None:
        if self._dimension is None:
            return
        if self._count + needed > self._capacity:
            new_capacity = min(self._max_vectors, max(self._initial_capacity, self._capacity * 2))
            if new_capacity < self._count + needed:
                new_capacity = min(self._max_vectors, self._count + needed)
            new_matrix = self._np.empty((new_capacity, self._dimension), dtype=self._np.float32)
            if self._count > 0:
                new_matrix[: self._count] = self._matrix[: self._count]
            self._matrix = new_matrix
            self._capacity = new_capacity

    def add(
        self,
        doc_id: str,
        embedding: Sequence[float],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if not doc_id:
            raise ValueError("A document ID is required.")
        if doc_id in self._id_to_idx:
            raise ValueError(f"Document {doc_id!r} is already indexed.")
        if len(self._ids) >= self._max_vectors:
            raise ValueError("Vector index capacity has been reached.")

        vector = validate_embedding(embedding, dimension=self._dimension)
        array = self._np.asarray(vector, dtype=self._np.float32)
        norm = self._np.linalg.norm(array)
        if not self._np.isfinite(norm) or norm == 0:
            raise ValueError("Zero-norm embeddings cannot be indexed.")

        normalized_vector = array / norm

        if self._dimension is None:
            self._dimension = len(vector)
            self._capacity = self._initial_capacity
            self._matrix = self._np.empty((self._capacity, self._dimension), dtype=self._np.float32)

        self._ensure_capacity(1)

        idx = self._count
        self._matrix[idx] = normalized_vector
        self._ids.append(doc_id)
        self._id_to_idx[doc_id] = idx
        self._metadata.append(dict(metadata or {}))
        self._count += 1

    def add_many(
        self,
        records: Sequence[tuple[str, Sequence[float]] | tuple[str, Sequence[float], dict[str, Any]]],
    ) -> None:
        for item in records:
            if len(item) == 2:
                doc_id, emb = item  # type: ignore[misc]
                meta = None
            else:
                doc_id, emb, meta = item  # type: ignore[misc]
            self.add(doc_id, emb, metadata=meta)

    def query(
        self,
        embedding: Sequence[float],
        *,
        top_k: int = 5,
        min_score: float | None = None,
    ) -> list[tuple[str, float]]:
        if top_k < 1:
            raise ValueError("top_k must be positive.")
        if not self._count:
            return []

        vector = self._np.asarray(
            validate_embedding(embedding, dimension=self._dimension),
            dtype=self._np.float32,
        )
        norm = self._np.linalg.norm(vector)
        if not self._np.isfinite(norm) or norm == 0:
            raise ValueError("Zero-norm embeddings cannot be queried.")

        normalized = vector / norm
        active_matrix = self._matrix[: self._count]
        scores = active_matrix @ normalized

        # Fast top-k using argpartition for large collections
        if self._count <= top_k:
            indices = self._np.argsort(-scores, kind="stable")
        else:
            partition = self._np.argpartition(-scores, top_k)[:top_k]
            sorted_subset = self._np.argsort(-scores[partition], kind="stable")
            indices = partition[sorted_subset]

        results: list[tuple[str, float]] = []
        for i in indices:
            score = float(scores[i])
            if min_score is not None and score < min_score:
                continue
            results.append((self._ids[int(i)], score))

        return results

    def query_with_metadata(
        self,
        embedding: Sequence[float],
        *,
        top_k: int = 5,
        min_score: float | None = None,
    ) -> list[tuple[str, float, dict[str, Any]]]:
        ranked = self.query(embedding, top_k=top_k, min_score=min_score)
        return [(doc_id, score, self._metadata[self._id_to_idx[doc_id]]) for doc_id, score in ranked]

    def get_metadata(self, doc_id: str) -> dict[str, Any] | None:
        idx = self._id_to_idx.get(doc_id)
        if idx is None:
            return None
        return self._metadata[idx]

    def clear(self) -> None:
        self._ids.clear()
        self._id_to_idx.clear()
        self._metadata.clear()
        self._count = 0
        if self._dimension is not None:
            self._capacity = self._initial_capacity
            self._matrix = self._np.empty((self._capacity, self._dimension), dtype=self._np.float32)

    def __len__(self) -> int:
        return self._count

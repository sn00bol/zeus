"""Unit tests for upgraded Search v2 components: filtering, vector indexing, fast embedder, and autonomous tools."""

from __future__ import annotations

import unittest

from src.tools.search import (
    SearchResult,
    SearchTool,
)
from vendor.search.embeddings import (
    HashingNgramVectorizer,
    reciprocal_rank_fusion,
)
from vendor.search.filter import ResultFilter
from vendor.search.vector import VectorIndex
from vendor.search.config import SearchConfig


class SearchV2FilterTests(unittest.TestCase):
    def test_strip_tracking_parameters(self) -> None:
        filter_inst = ResultFilter()
        url = "https://example.com/article?utm_source=facebook&utm_medium=cpc&id=123&fbclid=XYZ"
        canonical = filter_inst.normalize_url(url)
        self.assertEqual(canonical, "https://example.com/article?id=123")

    def test_filter_removes_junk_content_snippets(self) -> None:
        filter_inst = ResultFilter()
        results = [
            SearchResult("Valid Page", "https://example.com/page1", "A useful snippet containing facts.", "test"),
            SearchResult("404 Error", "https://example.com/page2", "404 Not Found. The resource does not exist.", "test"),
            SearchResult("Cloudflare", "https://example.com/page3", "Just a moment... Verify you are human.", "test"),
            SearchResult("Forbidden", "https://example.com/page4", "403 Forbidden. Access Denied.", "test"),
        ]
        accepted = filter_inst.filter(results)
        self.assertEqual(len(accepted), 1)
        self.assertEqual(accepted[0].url, "https://example.com/page1")


class VectorIndexOptimizationsTests(unittest.TestCase):
    def test_vector_index_metadata_and_batch_add(self) -> None:
        try:
            index = VectorIndex(initial_capacity=16)
        except RuntimeError:
            self.skipTest("NumPy is optional and is not installed.")
        records = [
            ("doc1", [1.0, 0.0, 0.0], {"title": "Doc 1", "category": "tech"}),
            ("doc2", [0.0, 1.0, 0.0], {"title": "Doc 2", "category": "health"}),
            ("doc3", [0.0, 0.0, 1.0], {"title": "Doc 3", "category": "finance"}),
        ]
        index.add_many(records)
        self.assertEqual(len(index), 3)

        results = index.query_with_metadata([0.9, 0.1, 0.0], top_k=2)
        self.assertEqual(len(results), 2)
        top_id, top_score, top_meta = results[0]
        self.assertEqual(top_id, "doc1")
        self.assertEqual(top_meta["title"], "Doc 1")
        self.assertGreater(top_score, 0.8)

    def test_vector_index_min_score_cutoff(self) -> None:
        try:
            index = VectorIndex()
        except RuntimeError:
            self.skipTest("NumPy is optional and is not installed.")
        index.add("x", [1.0, 0.0])
        index.add("y", [0.0, 1.0])

        filtered = index.query([1.0, 0.0], top_k=2, min_score=0.5)
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0][0], "x")


class HashingNgramVectorizerTests(unittest.TestCase):
    def test_vectorizer_properties(self) -> None:
        vectorizer = HashingNgramVectorizer(dimension=128)
        vec1 = vectorizer.vectorize("Python programming language")
        vec2 = vectorizer.vectorize("Python coding and developer language")
        vec3 = vectorizer.vectorize("Baking chocolate chip cookies in oven")

        self.assertEqual(len(vec1), 128)
        self.assertEqual(len(vec2), 128)

        # Dot product between unit vectors equals cosine similarity
        sim_related = sum(a * b for a, b in zip(vec1, vec2))
        sim_unrelated = sum(a * b for a, b in zip(vec1, vec3))

        self.assertGreater(sim_related, sim_unrelated)

    def test_reciprocal_rank_fusion(self) -> None:
        ranking1 = ["docA", "docB", "docC"]
        ranking2 = ["docB", "docA", "docD"]
        fused = reciprocal_rank_fusion([ranking1, ranking2])
        # Both docA and docB appear in top 2, should be at the top
        top_ids = [item for item, _ in fused[:2]]
        self.assertIn("docA", top_ids)
        self.assertIn("docB", top_ids)


class SearchToolTests(unittest.TestCase):
    def test_tool_definition(self) -> None:
        tool = SearchTool()
        defn = tool.definition
        self.assertEqual(defn.name, "web_search")
        self.assertIn("query", defn.parameters["properties"])
        self.assertEqual(
            defn.parameters["properties"]["limit"]["default"],
            SearchConfig().max_results,
        )
        self.assertEqual(defn.to_dict()["type"], "function")

    def test_automatic_screening(self) -> None:
        tool = SearchTool()
        query = "Python asyncio event loop"
        results = [
            SearchResult("Python asyncio event loop docs", "https://docs.python.org/asyncio", "Details on loop", "test"),
            SearchResult("Cooking recipes", "https://recipes.test/pasta", "Delicious pasta", "test"),
        ]
        screened = tool.screen_results(query, results, min_relevance_score=0.3)
        self.assertEqual(len(screened), 1)
        self.assertEqual(screened[0].url, "https://docs.python.org/asyncio")


if __name__ == "__main__":
    unittest.main()

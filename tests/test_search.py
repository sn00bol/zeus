from __future__ import annotations

import unittest

import httpx

from src.tools.search import (
    SEARCH_INTENT_PROMPT,
    SearXNGSearch,
    parse_search_decision,
    parse_search_relevance,
)


class SearXNGSearchTests(unittest.IsolatedAsyncioTestCase):
    def test_search_planner_errs_toward_real_world_fact_lookups(self) -> None:
        self.assertIn(
            "Err toward searching for factual questions and requests",
            SEARCH_INTENT_PROMPT,
        )
        self.assertIn(
            "If uncertain whether a factual answer is current or needs verification, search",
            SEARCH_INTENT_PROMPT,
        )
        self.assertIn("Do not search for greetings or conversation", SEARCH_INTENT_PROMPT)
        self.assertIn("breaking, or future events", SEARCH_INTENT_PROMPT)
        self.assertIn("evidence, proof, citations, fact-checks", SEARCH_INTENT_PROMPT)
        self.assertIn("official documentation, API behavior, changelogs", SEARCH_INTENT_PROMPT)
        self.assertIn("repository files, code, or examples", SEARCH_INTENT_PROMPT)

    async def test_search_uses_planned_query_and_filters_invalid_results(self) -> None:
        captured: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured.append(request)
            return httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                text=(
                    '<article class="result"><div class="result_inner">'
                    '<h3><a href="https://example.test/page">Primary <span>result</span></a></h3>'
                    '<p class="content">A useful <b>snippet</b>.</p></div>'
                    '<div class="engines"><span>test-engine</span></div></article>'
                    '<article class="result"><h3><a href="https://example.test/page">'
                    'Duplicate</a></h3><p class="content">Repeated.</p></article>'
                    '<article class="result"><h3><a href="javascript:alert(1)">Unsafe</a>'
                    '</h3><p class="content">Unsafe URL.</p></article>'
                    '<article class="result"><h3><a href="http://example.test/second">'
                    'Second result</a></h3><p class="content">Another snippet.</p>'
                    '<div class="engines"><span>test-engine</span></div></article>'
                ),
            )

        search = SearXNGSearch(
            "http://search.test/",
            transport=httpx.MockTransport(handler),
        )
        query = "FIFA World Cup 2026 winner final result"
        results = await search.search(query, limit=2)

        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].url.path, "/search")
        self.assertEqual(captured[0].headers["accept"], "text/html")
        self.assertEqual(
            dict(captured[0].url.params),
            {
                "q": query,
                "language": "all",
            },
        )
        self.assertEqual(
            [result.url for result in results],
            ["https://example.test/page", "http://example.test/second"],
        )
        self.assertEqual(results[0].title, "Primary result")
        self.assertEqual(results[0].content, "A useful snippet.")
        self.assertEqual(results[0].engine, "test-engine")

    async def test_search_propagates_http_errors_and_rejects_invalid_limits(self) -> None:
        def unavailable(_: httpx.Request) -> httpx.Response:
            return httpx.Response(503)

        search = SearXNGSearch(transport=httpx.MockTransport(unavailable))
        with self.assertRaises(httpx.HTTPStatusError):
            await search.search("latest news")
        with self.assertRaises(ValueError):
            await search.search("latest news", limit=13)

    async def test_empty_query_does_not_make_a_request(self) -> None:
        def fail_if_called(_: httpx.Request) -> httpx.Response:
            raise AssertionError("empty searches should not make HTTP requests")

        search = SearXNGSearch(transport=httpx.MockTransport(fail_if_called))
        self.assertEqual(await search.search("  "), [])

    async def test_search_rejects_json_api_responses(self) -> None:
        def json_response(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"results": []})

        search = SearXNGSearch(transport=httpx.MockTransport(json_response))
        with self.assertRaisesRegex(ValueError, "normal HTML search page"):
            await search.search("test query")

    def test_search_decision_parses_model_intent_and_query(self) -> None:
        decision = parse_search_decision(
            '{"use_search": true, "query": "World Cup 2026 winner", "skill": "search"}',
        )
        self.assertTrue(decision.use_search)
        self.assertEqual(decision.query, "World Cup 2026 winner")
        self.assertEqual(decision.skill, "search")

        no_search = parse_search_decision(
            '{"use_search": false, "query": "", "skill": "search"}',
        )
        self.assertFalse(no_search.use_search)

    def test_search_decision_falls_back_to_question_and_honors_explicit_selection(self) -> None:
        decision = parse_search_decision(
            "not JSON",
            fallback_query="original question",
            force_search=True,
        )
        self.assertTrue(decision.use_search)
        self.assertEqual(decision.query, "original question")

    def test_search_relevance_preserves_rank_and_rejects_invalid_ids(self) -> None:
        relevant = parse_search_relevance(
            '{"relevant_ids":[3,1]}',
            result_count=4,
        )
        self.assertEqual(relevant, [3, 1])
        self.assertEqual(
            parse_search_relevance('{"relevant_ids":[]}', result_count=4),
            [],
        )
        self.assertIsNone(
            parse_search_relevance('{"relevant_ids":[5]}', result_count=4),
        )
        self.assertIsNone(
            parse_search_relevance('{"relevant_ids":[true]}', result_count=4),
        )
        self.assertIsNone(
            parse_search_relevance('{"relevant_ids":[1,1]}', result_count=4),
        )


if __name__ == "__main__":
    unittest.main()

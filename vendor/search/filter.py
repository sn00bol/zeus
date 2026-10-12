"""Validation, canonicalization, tracking parameter stripping, and deduplication for search results."""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Iterable, Protocol, TypeVar
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_QUERY_PARAMS = frozenset({
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "utm_reader",
    "gclid",
    "fbclid",
    "msclkid",
    "twclid",
    "igshid",
    "ref",
    "ref_src",
    "source",
    "spm",
    "_hsenc",
    "_hsmi",
    "mc_cid",
    "mc_eid",
    "session_id",
    "yclid",
})

_JUNK_CONTENT_PATTERN = re.compile(
    r"(?i)\b("
    r"404\s+not\s+found|"
    r"page\s+not\s+found|"
    r"access\s+denied|"
    r"403\s+forbidden|"
    r"just\s+a\s+moment\.{2,3}|"
    r"verify\s+you\s+are\s+human|"
    r"enable\s+javascript\s+and\s+cookies|"
    r"enable\s+js\s+and\s+disable\s+any\s+ad\s+blocker|"
    r"checking\s+your\s+browser\s+before\s+accessing"
    r")\b"
)

_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)


class SearchResultLike(Protocol):
    url: str


ResultT = TypeVar("ResultT", bound=SearchResultLike)


class ResultFilter:
    """Filter, sanitize, and deduplicate search results with domain boundaries and anti-junk heuristics."""

    def __init__(
        self,
        *,
        allow_domains: Iterable[str] = (),
        blocked_domains: Iterable[str] = (),
        max_url_length: int = 2_048,
        strip_tracking: bool = True,
        filter_junk: bool = True,
        dedup_content: bool = False,
        dedup_content_threshold: float = 0.88,
    ) -> None:
        if max_url_length < 1:
            raise ValueError("Maximum URL length must be positive.")
        if not 0.0 <= dedup_content_threshold <= 1.0:
            raise ValueError("Deduplication threshold must be between 0.0 and 1.0.")
        self._allow_domains = _normalize_domains(allow_domains)
        self._blocked_domains = _normalize_domains(blocked_domains)
        self._max_url_length = max_url_length
        self._strip_tracking = strip_tracking
        self._filter_junk = filter_junk
        self._dedup_content = dedup_content
        self._dedup_content_threshold = dedup_content_threshold

    def filter(self, results: Iterable[ResultT]) -> list[ResultT]:
        accepted: list[ResultT] = []
        seen_urls: set[str] = set()
        accepted_tokens: list[frozenset[str]] = []

        for result in results:
            canonical = self.normalize_url(result.url)
            if canonical is None or canonical in seen_urls:
                continue

            host = urlsplit(canonical).hostname
            if host is None or not self._allowed(host):
                continue

            content = getattr(result, "content", None)
            title = getattr(result, "title", None)

            # Junk content check
            if self._filter_junk and isinstance(content, str) and content.strip():
                if _JUNK_CONTENT_PATTERN.search(content):
                    continue
                if isinstance(title, str) and _JUNK_CONTENT_PATTERN.search(title):
                    continue

            # Near-duplicate content check
            if self._dedup_content and isinstance(content, str) and len(content.strip()) > 30:
                tokens = frozenset(_token.casefold() for _token in _TOKEN_PATTERN.findall(content) if len(_token) > 2)
                if tokens and any(
                    _jaccard_similarity(tokens, prev_tokens) >= self._dedup_content_threshold
                    for prev_tokens in accepted_tokens
                ):
                    continue
                accepted_tokens.append(tokens)

            seen_urls.add(canonical)
            accepted.append(replace(result, url=canonical))

        return accepted

    def normalize_url(self, value: str) -> str | None:
        value = value.strip()
        if not value or len(value) > self._max_url_length:
            return None
        if any(character.isspace() for character in value):
            return None
        try:
            parsed = urlsplit(value)
            hostname = parsed.hostname
            port = parsed.port
        except ValueError:
            return None
        if (
            parsed.scheme.casefold() not in {"http", "https"}
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            return None
        hostname = hostname.rstrip(".").casefold()
        if not hostname:
            return None
        netloc = f"[{hostname}]" if ":" in hostname else hostname
        if port is not None and not (
            (parsed.scheme.casefold() == "http" and port == 80)
            or (parsed.scheme.casefold() == "https" and port == 443)
        ):
            netloc = f"{netloc}:{port}"

        # Clean query parameters
        query = parsed.query
        if self._strip_tracking and query:
            clean_qsl = [
                (k, v)
                for k, v in parse_qsl(query, keep_blank_values=True)
                if k.casefold() not in TRACKING_QUERY_PARAMS
            ]
            query = urlencode(clean_qsl) if clean_qsl else ""

        path = parsed.path or "/"
        canonical = urlunsplit((parsed.scheme.casefold(), netloc, path, query, ""))
        return canonical if len(canonical) <= self._max_url_length else None

    def _allowed(self, hostname: str) -> bool:
        if any(_matches(hostname, domain) for domain in self._blocked_domains):
            return False
        return not self._allow_domains or any(
            _matches(hostname, domain) for domain in self._allow_domains
        )


def _normalize_domains(domains: Iterable[str]) -> frozenset[str]:
    normalized_values: set[str] = set()
    for domain in domains:
        normalized = domain.strip().rstrip(".").casefold()
        if not normalized or any(character.isspace() for character in normalized):
            raise ValueError("Domain filters must contain valid, non-empty hostnames.")
        if any(character in normalized for character in "/:@?#"):
            raise ValueError("Domain filters must contain hostnames, not URLs.")
        normalized_values.add(normalized)
    return frozenset(normalized_values)


def _matches(hostname: str, domain: str) -> bool:
    return hostname == domain or hostname.endswith(f".{domain}")


def _jaccard_similarity(set_a: frozenset[str], set_b: frozenset[str]) -> float:
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return (intersection / union) if union else 0.0

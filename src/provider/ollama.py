"""
Ollama provider  (default: http://localhost:11434)

API reference: https://github.com/ollama/ollama/blob/main/docs/api.md
"""

from __future__ import annotations

import os
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

from .base import (
    BaseProvider,
    ModelFamily,
    ModelInfo,
    ModelLimits,
    ProviderEndpoint,
    _resolve_provider_address,
    detect_family,
    detect_modalities,
)

_DEFAULT_HOST = "localhost"
_DEFAULT_PORT = 11434


class OllamaProvider(BaseProvider):
    """Provider adapter for a locally running Ollama server."""

    name = "ollama"

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
    ) -> None:
        _host, _port = _resolve_provider_address(
            _DEFAULT_HOST,
            _DEFAULT_PORT,
            "OLLAMA_HOST",
            "OLLAMA_PORT",
            host,
            port,
        )
        super().__init__(_host, _port)

    # ------------------------------------------------------------------
    # Endpoint
    # ------------------------------------------------------------------

    def build_endpoint(self) -> ProviderEndpoint:
        base_url = f"http://{self.host}:{self.port}"
        return ProviderEndpoint(
            host=self.host,
            port=self.port,
            base_url=base_url,
            provider_name=self.name,
        )

    # ------------------------------------------------------------------
    # Model discovery
    # ------------------------------------------------------------------

    async def list_models(self) -> list[ModelInfo]:
        """GET /api/tags → list of available local models."""
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        url = f"{self.endpoint.base_url}/api/tags"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()

        models: list[ModelInfo] = []
        for entry in data.get("models", []):
            model_id: str = entry.get("name", "")
            if not model_id:
                continue
            limits = self._extract_limits(entry)
            models.append(self._build_model_info(model_id, entry, limits))
        return models

    async def get_model(self, model_id: str) -> ModelInfo | None:
        """POST /api/show → detailed model descriptor."""
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        url = f"{self.endpoint.base_url}/api/show"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                json={"name": model_id},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()

        limits = self._extract_limits(data)
        return self._build_model_info(model_id, data, limits)

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def ping(self) -> bool:
        if httpx is None:
            return False
        try:
            url = f"{self.endpoint.base_url}/"
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(url)
                reachable = resp.status_code < 500
                self.endpoint.is_reachable = reachable
                return reachable
        except Exception:
            self.endpoint.is_reachable = False
            return False

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_limits(raw: dict[str, Any]) -> ModelLimits:
        """
        Pull context_length and other limits out of the Ollama model detail.

        Ollama surfaces model parameters inside ``model_info`` (newer builds)
        or ``parameters`` (older string blob).
        """
        ctx = 2048
        max_new = 512

        # Newer: raw["model_info"]["llama.context_length"]
        model_info_block: dict[str, Any] = raw.get("model_info") or {}
        for key, val in model_info_block.items():
            if "context_length" in key and isinstance(val, int):
                ctx = val
                break

        # Older: parameters string blob e.g. "num_ctx 4096"
        if ctx == 2048:
            params_str: str = raw.get("parameters", "") or ""
            for line in params_str.splitlines():
                parts = line.split()
                if len(parts) == 2 and parts[0].lower() in {"num_ctx", "context_length"}:
                    try:
                        ctx = int(parts[1])
                    except ValueError:
                        pass
                    break

        # num_predict / max_new_tokens
        for line in (raw.get("parameters", "") or "").splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0].lower() in {"num_predict", "max_new_tokens"}:
                try:
                    max_new = int(parts[1])
                except ValueError:
                    pass
                break

        return ModelLimits(
            context_length=ctx,
            max_new_tokens=max_new,
            supports_streaming=True,
            supports_chat_format=True,
        )

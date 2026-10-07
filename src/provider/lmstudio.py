"""
LM Studio provider  (default: http://localhost:1234)

LM Studio exposes an OpenAI-compatible REST API:
  GET  /v1/models          – list loaded models
  POST /v1/chat/completions – chat inference
  POST /v1/completions      – legacy completions
  POST /v1/embeddings       – embeddings

API reference: https://lmstudio.ai/docs/api/openai-api
"""

from __future__ import annotations

import os
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

from .base import BaseProvider, ModelInfo, ModelLimits, ProviderEndpoint

_DEFAULT_HOST = "localhost"
_DEFAULT_PORT = 1234


class LMStudioProvider(BaseProvider):
    """Provider adapter for LM Studio's local OpenAI-compatible server."""

    name = "lmstudio"

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
    ) -> None:
        _host = host or os.environ.get("LLM_HOST") or os.environ.get("LMSTUDIO_HOST", _DEFAULT_HOST)
        port_value = os.environ.get("LLM_PORT") or os.environ.get("LMSTUDIO_PORT")
        _port = port or (
            _DEFAULT_PORT if not port_value or port_value.lower() == "default" else int(port_value)
        )
        super().__init__(_host, _port)

    # ------------------------------------------------------------------
    # Endpoint
    # ------------------------------------------------------------------

    def build_endpoint(self) -> ProviderEndpoint:
        base_url = f"http://{self.host}:{self.port}/v1"
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
        """GET /v1/models → list of currently loaded models."""
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        url = f"{self.endpoint.base_url}/models"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()

        models: list[ModelInfo] = []
        for entry in data.get("data", []):
            model_id: str = entry.get("id", "")
            if not model_id:
                continue
            limits = self._extract_limits(entry)
            models.append(self._build_model_info(model_id, entry, limits))
        return models

    async def get_model(self, model_id: str) -> ModelInfo | None:
        """GET /v1/models/{model_id} → single model descriptor."""
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        url = f"{self.endpoint.base_url}/models/{model_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
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
            url = f"{self.endpoint.base_url}/models"
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
        Extract limits from the OpenAI-compatible model object.

        LM Studio includes ``context_length`` directly on the model object
        (non-standard extension) and sometimes ``max_tokens``.
        """
        ctx = raw.get("context_length") or raw.get("n_ctx") or 2048
        max_new = raw.get("max_tokens") or 512

        # Nested under stats / info blocks (older LM Studio versions)
        if isinstance(ctx, dict):
            ctx = 2048
        if isinstance(max_new, dict):
            max_new = 512

        return ModelLimits(
            context_length=int(ctx),
            max_new_tokens=int(max_new),
            supports_streaming=True,
            supports_chat_format=True,
        )

"""
LlamaCPP provider  (default: http://localhost:8080)

Targets llama-server (the built-in HTTP server shipped with llama.cpp).
It speaks an OpenAI-compatible API subset plus its own /props and /health.

Endpoints used:
  GET  /health              – server health
  GET  /props               – server config (n_ctx, n_predict, model path …)
  GET  /v1/models           – list active model (single-model server)
  POST /v1/chat/completions – chat inference
  POST /v1/completions      – legacy completions
  POST /v1/embeddings       – embeddings (when built with embedding support)

Reference: https://github.com/ggerganov/llama.cpp/blob/master/tools/server/README.md
"""

from __future__ import annotations

import os
from pathlib import PurePosixPath
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

from .base import (
    BaseProvider,
    ModelInfo,
    ModelLimits,
    ProviderEndpoint,
    _resolve_provider_address,
)

_DEFAULT_HOST = "localhost"
_DEFAULT_PORT = 8080


class LlamaCppProvider(BaseProvider):
    """Provider adapter for llama-server (llama.cpp built-in HTTP server)."""

    name = "llamacpp"

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
    ) -> None:
        _host, _port = _resolve_provider_address(
            _DEFAULT_HOST,
            _DEFAULT_PORT,
            "LLAMACPP_HOST",
            "LLAMACPP_PORT",
            host,
            port,
        )
        super().__init__(_host, _port)
        # Cache the props fetched from /props so we don't hit it repeatedly
        self._props: dict[str, Any] | None = None

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
        """
        llama-server hosts a single model; we synthesise a model list from
        /props (which exposes the file path / alias used at startup).
        Falls back to /v1/models if it exists.
        """
        props = await self._fetch_props()

        # Try /v1/models first (newer llama-server builds)
        if httpx is None:
            raise RuntimeError("httpx is required: pip install httpx")

        try:
            url = f"{self.endpoint.base_url}/v1/models"
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data: dict[str, Any] = resp.json()
                    models = []
                    for entry in data.get("data", []):
                        mid = entry.get("id", "")
                        if mid:
                            limits = self._limits_from_props(props)
                            models.append(self._build_model_info(mid, entry, limits))
                    if models:
                        return models
        except Exception:
            pass

        # Fallback: synthesise from /props model path
        model_id = self._model_id_from_props(props)
        limits = self._limits_from_props(props)
        return [self._build_model_info(model_id, props, limits)]

    async def get_model(self, model_id: str) -> ModelInfo | None:
        models = await self.list_models()
        return next((m for m in models if m.id == model_id), None)

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def ping(self) -> bool:
        if httpx is None:
            return False
        try:
            url = f"{self.endpoint.base_url}/health"
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(url)
                # llama-server returns {"status":"ok"} or 503 if loading
                reachable = resp.status_code in {200, 503}
                self.endpoint.is_reachable = reachable
                return reachable
        except Exception:
            self.endpoint.is_reachable = False
            return False

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _fetch_props(self) -> dict[str, Any]:
        """GET /props – cached for the lifetime of the provider object."""
        if self._props is not None:
            return self._props
        if httpx is None:
            return {}
        try:
            url = f"{self.endpoint.base_url}/props"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    self._props = resp.json()
                    return self._props
        except Exception:
            pass
        self._props = {}
        return self._props

    @staticmethod
    def _model_id_from_props(props: dict[str, Any]) -> str:
        """Derive a readable model id from the file path in /props."""
        model_path: str = props.get("model", "") or props.get("model_path", "") or "unknown"
        stem = PurePosixPath(model_path.replace("\\", "/")).stem
        return stem or "llamacpp-model"

    @staticmethod
    def _limits_from_props(props: dict[str, Any]) -> ModelLimits:
        """
        Extract limits from the /props response.

        llama-server exposes:
          n_ctx        – context window (total tokens)
          n_predict    – max tokens to generate  (-1 = unlimited)
          n_slots      – number of parallel inference slots
        """
        n_ctx: int = int(props.get("n_ctx", 0) or props.get("total_slots", 0) or 2048)
        if n_ctx <= 0:
            n_ctx = 2048

        n_predict: int = int(props.get("n_predict", -1) or -1)
        max_new = n_predict if n_predict > 0 else 512

        # Embedding-capable builds expose this flag
        has_embed: bool = bool(props.get("pooling_type") is not None or props.get("embeddings"))

        return ModelLimits(
            context_length=n_ctx,
            max_new_tokens=max_new,
            supports_streaming=True,
            supports_chat_format=True,
            extra={"has_embeddings": has_embed},
        )

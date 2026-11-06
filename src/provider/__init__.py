"""
src/provider — LLM backend adapters.

Supported backends
------------------
- ollama   : Ollama  (http://localhost:11434)
- lmstudio : LM Studio  (http://localhost:1234)
- llamacpp : llama-server / llama.cpp  (http://localhost:8080)
"""

from __future__ import annotations

from .base import (
    BaseProvider,
    ModelFamily,
    ModelInfo,
    ModelLimits,
    Modality,
    ProviderEndpoint,
    detect_family,
    detect_modalities,
    detect_supports_thinking,
    detect_supports_vision,
)
from .llamacpp import LlamaCppProvider
from .lmstudio import LMStudioProvider
from .ollama import OllamaProvider

_REGISTRY: dict[str, type[BaseProvider]] = {
    "ollama":   OllamaProvider,
    "lmstudio": LMStudioProvider,
    "llamacpp": LlamaCppProvider,
}


def get_provider(name: str, host: str | None = None, port: int | None = None) -> BaseProvider:
    """
    Factory: instantiate a provider by name.

    Parameters
    ----------
    name : str
        One of ``"ollama"``, ``"lmstudio"``, ``"llamacpp"``.
    host : str, optional
        Override the default host. Falls back to env vars then the provider default.
    port : int, optional
        Override the default port. Falls back to env vars then the provider default.

    Raises
    ------
    ValueError
        If *name* is not a recognised provider.
    """
    cls = _REGISTRY.get(name.lower())
    if cls is None:
        supported = ", ".join(sorted(_REGISTRY))
        raise ValueError(f"Unknown provider '{name}'. Supported: {supported}")
    kwargs: dict[str, object] = {}
    if host is not None:
        kwargs["host"] = host
    if port is not None:
        kwargs["port"] = port
    return cls(**kwargs)  # type: ignore[arg-type]


__all__ = [
    "BaseProvider",
    "LlamaCppProvider",
    "LMStudioProvider",
    "ModelFamily",
    "ModelInfo",
    "ModelLimits",
    "Modality",
    "OllamaProvider",
    "ProviderEndpoint",
    "detect_family",
    "detect_modalities",
    "detect_supports_thinking",
    "detect_supports_vision",
    "get_provider",
]

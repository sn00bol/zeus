"""
Base provider interface for all LLM backends.

Every concrete provider must implement this interface so the router
can treat Ollama, LM Studio, and LlamaCPP uniformly.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class ModelFamily(str, Enum):
    """Broad architectural / training lineage of a model."""
    LLAMA     = "llama"
    MISTRAL   = "mistral"
    GEMMA     = "gemma"
    PHI       = "phi"
    QWEN      = "qwen"
    DEEPSEEK  = "deepseek"
    FALCON    = "falcon"
    BLOOM     = "bloom"
    GPT_NEO   = "gpt-neo"
    STARCODER = "starcoder"
    CODEGEN   = "codegen"
    UNKNOWN   = "unknown"


class Modality(str, Enum):
    """Data modalities a model can process."""
    TEXT    = "text"
    IMAGE   = "image"
    AUDIO   = "audio"
    VIDEO   = "video"
    CODE    = "code"
    EMBED   = "embedding"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ModelLimits:
    """Hard limits exposed by the backend for a specific model."""
    context_length: int = 2048          # max tokens in prompt + response
    max_new_tokens: int = 512           # max tokens the model will generate
    supports_streaming: bool = True
    supports_chat_format: bool = True   # /chat/completions vs /completions
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelInfo:
    """Full descriptor for a discovered model."""
    id: str                                             # raw model id / name
    family: ModelFamily = ModelFamily.UNKNOWN
    modalities: list[Modality] = field(default_factory=lambda: [Modality.TEXT])
    limits: ModelLimits = field(default_factory=ModelLimits)
    raw: dict[str, Any] = field(default_factory=dict)  # full API response


@dataclass
class ProviderEndpoint:
    """Recorded API endpoint for a provider instance."""
    host: str
    port: int
    base_url: str
    provider_name: str
    is_reachable: bool = False


# ---------------------------------------------------------------------------
# Family detection helpers (shared across all providers)
# ---------------------------------------------------------------------------

_FAMILY_PATTERNS: list[tuple[re.Pattern[str], ModelFamily]] = [
    (re.compile(r"llama",           re.IGNORECASE), ModelFamily.LLAMA),
    (re.compile(r"mistral|mixtral", re.IGNORECASE), ModelFamily.MISTRAL),
    (re.compile(r"gemma",           re.IGNORECASE), ModelFamily.GEMMA),
    (re.compile(r"phi",             re.IGNORECASE), ModelFamily.PHI),
    (re.compile(r"qwen",            re.IGNORECASE), ModelFamily.QWEN),
    (re.compile(r"deepseek",        re.IGNORECASE), ModelFamily.DEEPSEEK),
    (re.compile(r"falcon",          re.IGNORECASE), ModelFamily.FALCON),
    (re.compile(r"bloom",           re.IGNORECASE), ModelFamily.BLOOM),
    (re.compile(r"gpt.?neo",        re.IGNORECASE), ModelFamily.GPT_NEO),
    (re.compile(r"starcoder",       re.IGNORECASE), ModelFamily.STARCODER),
    (re.compile(r"codegen",         re.IGNORECASE), ModelFamily.CODEGEN),
]

_VISION_PATTERNS = re.compile(
    r"vision|vl\b|llava|bakllava|moondream|minicpm.?v|qwen.?vl", re.IGNORECASE
)
_AUDIO_PATTERNS  = re.compile(r"whisper|audio|speech", re.IGNORECASE)
_CODE_PATTERNS   = re.compile(
    r"code|coder|starcoder|codegen|deepseek.?coder|qwen.?coder", re.IGNORECASE
)
_EMBED_PATTERNS  = re.compile(r"embed|bge|nomic|e5\b|gte\b", re.IGNORECASE)


def detect_family(model_id: str) -> ModelFamily:
    """Infer the model family from a model name / id string."""
    for pattern, family in _FAMILY_PATTERNS:
        if pattern.search(model_id):
            return family
    return ModelFamily.UNKNOWN


def detect_modalities(model_id: str) -> list[Modality]:
    """Infer which modalities a model supports from its name."""
    modalities: list[Modality] = [Modality.TEXT]
    if _VISION_PATTERNS.search(model_id):
        modalities.append(Modality.IMAGE)
    if _AUDIO_PATTERNS.search(model_id):
        modalities.append(Modality.AUDIO)
    if _CODE_PATTERNS.search(model_id):
        modalities.append(Modality.CODE)
    if _EMBED_PATTERNS.search(model_id):
        modalities.append(Modality.EMBED)
    return modalities


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------

class BaseProvider(ABC):
    """
    Abstract base that every LLM backend provider must extend.

    Concrete providers handle:
    - Building their ProviderEndpoint from config / env
    - Fetching the live model list from their API
    - Translating raw API response data into ModelInfo objects
    """

    name: str = "base"

    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port
        self._endpoint: ProviderEndpoint | None = None

    # ------------------------------------------------------------------
    # Endpoint recording
    # ------------------------------------------------------------------

    @abstractmethod
    def build_endpoint(self) -> ProviderEndpoint:
        """Construct and record the ProviderEndpoint for this backend."""

    @property
    def endpoint(self) -> ProviderEndpoint:
        if self._endpoint is None:
            self._endpoint = self.build_endpoint()
        return self._endpoint

    # ------------------------------------------------------------------
    # Model discovery
    # ------------------------------------------------------------------

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        """Return all models currently available on this backend."""

    @abstractmethod
    async def get_model(self, model_id: str) -> ModelInfo | None:
        """Return detailed info for a single model, or None if not found."""

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    @abstractmethod
    async def ping(self) -> bool:
        """Return True if the backend API is reachable."""

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------

    def _build_model_info(
        self,
        model_id: str,
        raw: dict[str, Any],
        limits: ModelLimits | None = None,
    ) -> ModelInfo:
        """Construct a ModelInfo from a raw API response dict."""
        return ModelInfo(
            id=model_id,
            family=detect_family(model_id),
            modalities=detect_modalities(model_id),
            limits=limits or ModelLimits(),
            raw=raw,
        )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} {self.host}:{self.port}>"

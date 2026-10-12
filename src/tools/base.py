"""Base abstractions for agentic tools in Zeus."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class ToolDefinition:
    """OpenAI/Anthropic compatible function tool specification."""

    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class BaseTool(ABC):
    """Abstract base class for all callable tools."""

    @property
    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return tool schema definition for model context."""
        ...

    @abstractmethod
    async def execute(self, **kwargs: Any) -> Any:
        """Execute the tool asynchronously with keyword arguments."""
        ...

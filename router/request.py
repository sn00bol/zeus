from __future__ import annotations

import logging
from typing import Any, Optional
from router.router import Router, InferenceRequest, InferenceResponse, Message

log = logging.getLogger(__name__)


class RequestRouter:
    """
    Entry point facade for platform requests.

    Transforms platform-specific payloads into InferenceRequests and manages
    dispatching through the central Router.
    """

    def __init__(self, router: Router):
        self.router = router

    async def handle_request(
        self,
        user_id: str,
        user_message: str,
        platform: str,
        conversation_id: Optional[str] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
        extra_params: Optional[dict[str, Any]] = None,
    ) -> InferenceResponse:
        """
        Process an incoming chat request from any supported platform.
        """
        try:
            formatted_messages = [Message(role="user", content=user_message)]

            request = InferenceRequest(
                messages=formatted_messages,
                model=model,
                provider_name=provider,
                platform=platform,
                extra=extra_params or {},
            )

            log.info("Routing request from %s (user: %s, provider: %s)", platform, user_id, provider)
            response = await self.router.route(request)
            return response

        except Exception as e:
            log.exception("Error in RequestRouter while handling request from %s: %s", platform, e)
            return InferenceResponse(
                content="An error occurred while processing your request.",
                model="error",
                provider="error",
                raw={"error": str(e)},
            )


_instance: Optional[RequestRouter] = None


def get_request_router(router: Router) -> RequestRouter:
    global _instance
    if _instance is None:
        _instance = RequestRouter(router)
    return _instance

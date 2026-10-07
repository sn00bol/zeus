from __future__ import annotations

import logging
from typing import Any, Optional
from router.router import Router, InferenceRequest, InferenceResponse

log = logging.getLogger(__name__)

class RequestRouter:
    """
    The RequestRouter acts as the entry point for all platform requests.
    It handles the transformation of platform-specific data into
    InferenceRequests and manages the communication with the backend Router.
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
        Main entry point to process a request from any platform.
        """
        try:
            # 1. Construct the InferenceRequest
            # Note: In a real scenario, you'd fetch conversation history from MemoryStore here.
            messages = [
                {"role": "user", "content": user_message}
            ]
            
            from router.router import Message
            formatted_messages = [Message(role=m["role"], content=m["content"]) for m in messages]

            request = InferenceRequest(
                messages=formatted_messages,
                model=model,
                provider_name=provider,
                platform=platform,
                extra=extra_params or {},
            )

            # 2. Call the backend router
            log.info(f"Routing request from {platform} (user: {user_id})")
            response = await self.router.route(request)
            
            return response

        except Exception as e:
            log.exception(f"Error in RequestRouter while handling request from {platform}: {e}")
            return InferenceResponse(
                content="An error occurred while processing your request.",
                model="error",
                provider="error",
                raw={"error": str(e)}
            )

_instance: Optional[RequestRouter] = None

def get_request_router(router: Router) -> RequestRouter:
    global _instance
    if _instance is None:
        _instance = RequestRouter(router)
    return _instance

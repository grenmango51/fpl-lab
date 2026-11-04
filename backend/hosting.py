"""Only the authenticated Cloudflare gateway can reach the hosted API."""

import hmac
import os

from starlette.responses import JSONResponse


class OriginOnly:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = os.environ.get("OPEN_FPL_ORIGIN_TOKEN", "")
        if scope["type"] != "http" or not token:
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        supplied = headers.get(b"x-open-fpl-origin-token", b"")
        if not hmac.compare_digest(supplied, token.encode()):
            return await JSONResponse({"detail": "This planner is private."}, status_code=403)(scope, receive, send)
        await self.app(scope, receive, send)

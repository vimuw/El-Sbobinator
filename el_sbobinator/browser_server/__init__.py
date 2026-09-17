"""
Browser server package for El Sbobinator.

Provides a local FastAPI host and WebSocket dispatcher for agentic debugging,
browser development, and Playwright E2E testing.
"""

from __future__ import annotations

from el_sbobinator.browser_server.server import create_browser_app
from el_sbobinator.browser_server.ws_dispatcher import WebSocketDispatcher

__all__ = ["WebSocketDispatcher", "create_browser_app"]

"""
Cached NotebookLM authentication health check used by the runner status command.

The probe loads the wrapper's saved browser session without issuing production
queries. Run notebooklm login, or use the wizard's reauthentication flow, when
the saved session is missing or expired.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = float(os.environ.get("BRIDGE_AUTH_CHECK_TTL", "300"))
_cached_status: Optional[dict] = None
_cached_at: float = 0.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _probe() -> dict:
    """Load and verify the saved NotebookLM browser session."""
    try:
        from notebooklm import NotebookLMClient
    except ImportError as error:
        return {
            "status": "missing",
            "details": f"notebooklm-py is not installed: {error}",
        }

    try:
        await NotebookLMClient.from_storage()
        return {
            "status": "valid",
            "details": "Cookies loaded and verified.",
        }
    except FileNotFoundError as error:
        return {
            "status": "missing",
            "details": (
                "No saved cookies. Run notebooklm login "
                f"before starting the wizard. ({error})"
            ),
        }
    except ValueError as error:
        message = str(error)
        if "expired" in message.lower() or "invalid" in message.lower():
            return {
                "status": "expired",
                "details": (
                    "Session cookies expired. Run notebooklm login again."
                ),
            }
        return {"status": "unknown", "details": message}
    except Exception as error:
        logger.debug("Authentication probe failed", exc_info=True)
        return {
            "status": "unknown",
            "details": f"{type(error).__name__}: {error}",
        }


def _cache_lookup(force: bool) -> Optional[dict]:
    if force or _cached_status is None:
        return None

    age = time.monotonic() - _cached_at
    if age >= _CACHE_TTL_SECONDS:
        return None
    return {
        **_cached_status,
        "cached": True,
        "cache_age_seconds": round(age, 1),
    }


def _cache_store(result: dict) -> None:
    global _cached_status, _cached_at
    _cached_status = result
    _cached_at = time.monotonic()


async def check_auth_status_async(force: bool = False) -> dict:
    """Return valid, expired, missing, or unknown authentication status."""
    cached = _cache_lookup(force)
    if cached is not None:
        return cached

    result = await _probe()
    result["checked_at"] = _now_iso()
    result["cached"] = False
    _cache_store(result)
    return result

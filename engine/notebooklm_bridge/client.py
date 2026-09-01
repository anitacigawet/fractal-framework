"""
Polite async client for the NotebookLM wrapper used by Fractal Framework.

Pre-requisite: run `notebooklm login` once (or use the wizard's
reauthentication flow) to
generate session cookies. The client loads them via `NotebookLMClient.from_storage()`.

IMPORTANT: NotebookLM has no official public API. The library used here is a
community wrapper that reverse-engineers the web app. Be a good citizen:

  - Default cooldown of 8 seconds between calls, with random jitter on top
    so inter-call timing is not perfectly regular (mechanical-fingerprint guard).
  - Exponential backoff on errors.
  - Strict serial via async lock — never parallel.
  - Operating-hours guard rejects calls outside human-plausible hours by default.
  - Per-day query budget caps total API calls per local-day.

All disciplines are tunable via BRIDGE_* environment variables. To see/disable any:

  BRIDGE_COOLDOWN                  (default 8.0; min seconds between calls)
  BRIDGE_JITTER_MIN/MAX            (default 1.0/3.0; random extra seconds)
  BRIDGE_MAX_RETRIES               (default 3)

  BRIDGE_OPERATING_HOURS_ENABLED   (default true)
  BRIDGE_OPERATING_HOURS_START     (default 7;  inclusive, 24h local)
  BRIDGE_OPERATING_HOURS_END       (default 24; exclusive, 24h local — i.e. midnight)

  BRIDGE_DAILY_QUERY_BUDGET        (default 100; calls per local-day)
  BRIDGE_DAILY_BUDGET_ENABLED      (default true)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Rate limiting defaults ────────────────────────────────────────
_DEFAULT_COOLDOWN_SECONDS = float(os.environ.get("BRIDGE_COOLDOWN", "8.0"))
_COOLDOWN_JITTER_MIN = float(os.environ.get("BRIDGE_JITTER_MIN", "1.0"))
_COOLDOWN_JITTER_MAX = float(os.environ.get("BRIDGE_JITTER_MAX", "3.0"))
_MAX_RETRIES = int(os.environ.get("BRIDGE_MAX_RETRIES", "3"))
_BACKOFF_BASE = 2.0  # exponential backoff base, seconds

# ── Operating-hours guard ─────────────────────────────────────────
# Reject calls outside human-plausible hours by default. The unofficial
# API may flag activity at 3 AM; we'd rather hard-stop than risk it.
_OPERATING_HOURS_ENABLED = os.environ.get("BRIDGE_OPERATING_HOURS_ENABLED", "true").lower() == "true"
_OPERATING_HOURS_START = int(os.environ.get("BRIDGE_OPERATING_HOURS_START", "7"))   # 07:00 local
_OPERATING_HOURS_END = int(os.environ.get("BRIDGE_OPERATING_HOURS_END", "24"))      # 24:00 (midnight) local

# ── Per-day query budget ──────────────────────────────────────────
# Soft cap on total API calls per local-day. Persists across process
# restarts via .budget.json in the package directory. Reset is automatic
# on date change.
_DAILY_BUDGET_ENABLED = os.environ.get("BRIDGE_DAILY_BUDGET_ENABLED", "true").lower() == "true"
_DAILY_QUERY_BUDGET = int(os.environ.get("BRIDGE_DAILY_QUERY_BUDGET", "100"))
_BUDGET_FILE = Path(__file__).resolve().parent / ".budget.json"


class OutsideOperatingHoursError(RuntimeError):
    """Raised when an API call is attempted outside the configured operating hours."""


class DailyBudgetExceededError(RuntimeError):
    """Raised when the per-day query budget has been exhausted."""


def _today_local() -> str:
    return datetime.now().date().isoformat()


def _check_operating_hours() -> None:
    """Raise OutsideOperatingHoursError if current local time is outside window."""
    if not _OPERATING_HOURS_ENABLED:
        return
    now = datetime.now()
    if now.hour < _OPERATING_HOURS_START or now.hour >= _OPERATING_HOURS_END:
        raise OutsideOperatingHoursError(
            f"Current local time {now.strftime('%H:%M')} is outside operating hours "
            f"{_OPERATING_HOURS_START:02d}:00-{_OPERATING_HOURS_END:02d}:00. "
            f"Set BRIDGE_OPERATING_HOURS_ENABLED=false to override."
        )


def _load_budget_state() -> dict:
    """Load the budget counter, auto-resetting if the date has rolled over."""
    today = _today_local()
    if _BUDGET_FILE.exists():
        try:
            data = json.loads(_BUDGET_FILE.read_text())
            if data.get("date") == today:
                return data
        except Exception:
            logger.warning("Could not parse %s; resetting budget state.", _BUDGET_FILE)
    return {"date": today, "count": 0}


def _save_budget_state(state: dict) -> None:
    try:
        _BUDGET_FILE.write_text(json.dumps(state))
    except Exception:
        logger.warning("Could not persist budget state to %s", _BUDGET_FILE)


def _check_and_increment_budget() -> None:
    """Raise DailyBudgetExceededError if budget is exhausted; else increment."""
    if not _DAILY_BUDGET_ENABLED:
        return
    state = _load_budget_state()
    if state["count"] >= _DAILY_QUERY_BUDGET:
        raise DailyBudgetExceededError(
            f"Daily query budget ({_DAILY_QUERY_BUDGET}) exhausted "
            f"({state['count']} calls today, date={state['date']}). "
            f"Reset is automatic on local-date change. "
            f"Set BRIDGE_DAILY_QUERY_BUDGET higher or BRIDGE_DAILY_BUDGET_ENABLED=false to override."
        )
    state["count"] += 1
    _save_budget_state(state)


def get_budget_status() -> dict:
    """Return the local daily-budget state without changing it."""
    state = _load_budget_state()
    return {
        "enabled": _DAILY_BUDGET_ENABLED,
        "limit": _DAILY_QUERY_BUDGET,
        "count_today": state["count"],
        "remaining": max(0, _DAILY_QUERY_BUDGET - state["count"]),
        "date": state["date"],
    }


# Per-RPC httpx timeout passed to NotebookLMClient.from_storage(). Upstream
# defaults to 30s, which is too tight for bulk operations like IMPORT_RESEARCH
# (observed timing out at 30s with ~10 sources). Default 120s here covers
# typical bulk imports; bump higher via the env var if you see RPCTimeoutError
# in the bridge logs.
_HTTPX_TIMEOUT = float(os.environ.get("BRIDGE_HTTPX_TIMEOUT", "120"))

class BridgeNotebookLMClient:
    """
    Polite async client. Lifecycle:
        client = BridgeNotebookLMClient()
        await client.open()
        try:
            answer = await client.query(notebook_id, prompt_text)
        finally:
            await client.close()
    """

    def __init__(self, cooldown_seconds: float = _DEFAULT_COOLDOWN_SECONDS):
        self._client_instance = None
        self._client = None
        self._last_call_at: float = 0.0
        self._cooldown = cooldown_seconds
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        """Load session cookies and open the underlying client."""
        from notebooklm import NotebookLMClient  # imported lazily

        self._client_instance = await NotebookLMClient.from_storage(timeout=_HTTPX_TIMEOUT)
        self._client = await self._client_instance.__aenter__()
        logger.info(
            "NotebookLM client opened (cooldown=%.1fs, httpx_timeout=%.0fs)",
            self._cooldown, _HTTPX_TIMEOUT,
        )

    async def close(self) -> None:
        if self._client_instance:
            await self._client_instance.__aexit__(None, None, None)
            self._client_instance = None
            self._client = None
            logger.info("NotebookLM client closed")

    async def _respect_cooldown(self) -> None:
        """
        Pre-API-call discipline gate. Runs ALL of:
          1. Operating-hours guard  — hard-fail if outside window
          2. Daily budget check     — hard-fail if exhausted, otherwise increment
          3. Cooldown with jitter   — sleep until safe to call

        All API methods call this once before each network hit (inside the
        async lock, which serializes calls).

        Raises:
            OutsideOperatingHoursError, DailyBudgetExceededError
        """
        _check_operating_hours()
        _check_and_increment_budget()

        elapsed = time.monotonic() - self._last_call_at
        # Jitter is additive: the actual wait floor is cooldown + uniform(min, max).
        # This makes inter-call timing visibly non-mechanical.
        jitter = random.uniform(_COOLDOWN_JITTER_MIN, _COOLDOWN_JITTER_MAX)
        target_wait = self._cooldown + jitter
        if elapsed < target_wait:
            wait = target_wait - elapsed
            logger.debug(
                "Cooldown: sleeping %.2fs (cooldown=%.1fs + jitter=%.2fs)",
                wait, self._cooldown, jitter,
            )
            await asyncio.sleep(wait)

    async def create_notebook(self, title: str) -> str:
        """Create a new NotebookLM notebook. Returns the notebook ID."""
        if self._client is None:
            raise RuntimeError("Client not opened. Call await client.open() first.")
        async with self._lock:
            await self._respect_cooldown()
            try:
                nb = await self._client.notebooks.create(title)
                return nb.id
            finally:
                self._last_call_at = time.monotonic()

    async def add_url_source(self, notebook_id: str, url: str, wait: bool = True) -> None:
        """
        Upload a URL (e.g., USGS report) as a source on a notebook.
        wait=True blocks until ingestion completes.
        """
        if self._client is None:
            raise RuntimeError("Client not opened. Call await client.open() first.")
        async with self._lock:
            await self._respect_cooldown()
            try:
                await self._client.sources.add_url(notebook_id, url, wait=wait)
            finally:
                self._last_call_at = time.monotonic()

    async def add_file_source(
        self, notebook_id: str, file_path: str, wait: bool = True
    ) -> None:
        """Upload a local file (e.g., a PDF) as a source on a notebook."""
        if self._client is None:
            raise RuntimeError("Client not opened. Call await client.open() first.")
        async with self._lock:
            await self._respect_cooldown()
            try:
                await self._client.sources.add_file(notebook_id, file_path, wait=wait)
            finally:
                self._last_call_at = time.monotonic()

    # ── Deep / Fast Research (Phase A) ──────────────────────────────
    #
    # The wrapper exposes research.start, research.poll, and
    # research.import_sources for both modes. Deep remains the default for
    # direct CLI use; the wizard may select Fast for interactive runs.
    #
    # Validation rules from upstream:
    #   - source ∈ {"web", "drive"}
    #   - mode ∈ {"fast", "deep"}
    #   - mode="deep" only valid with source="web"
    # We hard-code source="web".

    async def start_deep_research(
        self,
        notebook_id: str,
        query: str,
        mode: str = "deep",
    ) -> dict:
        """
        Kick off a Research session against the notebook. mode ∈ {"deep", "fast"};
        default "deep" preserves prior behavior. Returns a dict with task_id,
        report_id, notebook_id, query, mode.
        """
        if mode not in ("deep", "fast"):
            raise ValueError(f"mode must be 'deep' or 'fast', got {mode!r}")
        if self._client is None:
            raise RuntimeError("Client not opened. Call await client.open() first.")
        async with self._lock:
            await self._respect_cooldown()
            try:
                research = await self._client.research.start(
                    notebook_id, query, source="web", mode=mode
                )
                logger.info(
                    "Research started (mode=%s): notebook=%s task=%s",
                    mode, notebook_id,
                    research.get("task_id") if research else None,
                )
                return research or {}
            finally:
                self._last_call_at = time.monotonic()

    async def poll_research(self, notebook_id: str) -> dict:
        """
        Poll the in-flight research session. Returns a dict with at least
        {status, sources}. status ∈ {"running", "completed", ...} per upstream.
        """
        if self._client is None:
            raise RuntimeError("Client not opened.")
        async with self._lock:
            await self._respect_cooldown()
            try:
                return await self._client.research.poll(notebook_id)
            finally:
                self._last_call_at = time.monotonic()

    async def wait_for_research(
        self,
        notebook_id: str,
        timeout_seconds: float = 900.0,   # 15 min default
        poll_interval: float = 15.0,
    ) -> dict:
        """
        Poll until research completes (or timeout). Returns the final poll
        dict — caller checks status == "completed" before importing sources.

        timeout_seconds default is generous; Deep Research can take several
        minutes. poll_interval enforces a minimum delay between polls in
        addition to the per-call cooldown.
        """
        deadline = time.monotonic() + timeout_seconds
        last_status = {"status": "unknown"}
        while time.monotonic() < deadline:
            last_status = await self.poll_research(notebook_id)
            state = last_status.get("status")
            if state == "completed":
                logger.info(
                    "Deep Research completed for notebook %s — %d sources",
                    notebook_id, len(last_status.get("sources") or []),
                )
                return last_status
            logger.debug("Deep Research polling: state=%s", state)
            await asyncio.sleep(poll_interval)
        logger.warning(
            "Deep Research timed out after %.0fs (last state=%s)",
            timeout_seconds, last_status.get("status"),
        )
        return last_status

    async def import_research_sources(
        self,
        notebook_id: str,
        task_id: str,
        sources: list,
    ) -> dict:
        """
        Programmatically import sources discovered by a Deep Research session.
        Replaces the manual "Import" click in the NotebookLM web UI.

        `sources` is the list returned by poll_research()['sources']. Slice
        before passing if you want to cap the imported count.
        """
        if self._client is None:
            raise RuntimeError("Client not opened.")
        async with self._lock:
            await self._respect_cooldown()
            try:
                result = await self._client.research.import_sources(
                    notebook_id, task_id, sources
                )
                logger.info(
                    "Imported %d research sources into notebook %s",
                    len(sources), notebook_id,
                )
                return result if isinstance(result, dict) else {"imported": len(sources)}
            finally:
                self._last_call_at = time.monotonic()

    async def configure_prompt(self, notebook_id: str, prompt_text: str) -> None:
        """
        Apply a custom prompt (the Trust Server persona) to a notebook before
        querying it. Sets goal=CUSTOM and response_length=LONGER per the
        canonical persona-configuration pattern.
        """
        from notebooklm import ChatGoal, ChatResponseLength
        if self._client is None:
            raise RuntimeError("Client not opened. Call await client.open() first.")

        async with self._lock:
            await self._respect_cooldown()
            try:
                await self._client.chat.configure(
                    notebook_id=notebook_id,
                    goal=ChatGoal.CUSTOM,
                    response_length=ChatResponseLength.LONGER,
                    custom_prompt=prompt_text,
                )
            finally:
                self._last_call_at = time.monotonic()

    async def query(self, notebook_id: str, query_text: str) -> str:
        """Send a query to a notebook. Returns the text answer."""
        if self._client is None:
            raise RuntimeError("Client not opened. Call await client.open() first.")

        last_error: Optional[Exception] = None
        for attempt in range(1, _MAX_RETRIES + 1):
            async with self._lock:
                await self._respect_cooldown()
                try:
                    result = await self._client.chat.ask(notebook_id, query_text)
                    self._last_call_at = time.monotonic()
                    return result.answer
                except Exception as e:
                    self._last_call_at = time.monotonic()
                    last_error = e
                    backoff = _BACKOFF_BASE ** attempt
                    logger.warning(
                        "NotebookLM query failed (attempt %d/%d): %s. Backing off %.1fs",
                        attempt, _MAX_RETRIES, e, backoff
                    )
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(backoff)

        raise RuntimeError(f"NotebookLM query failed after {_MAX_RETRIES} attempts: {last_error}")

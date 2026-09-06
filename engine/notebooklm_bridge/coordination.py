"""Process-shared call timing and budget reservations, using only the stdlib.

The call lock spans the whole upstream operation. A separate, short state lock
allows status reads and budget reservations while a call is in progress. Lock
files are stable: never unlink them, since replacing a locked inode would split
the coordination domain. The OS releases their locks when a process exits.
"""
from __future__ import annotations

import asyncio
import errno
import json
import math
import os
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Callable


class CoordinationError(RuntimeError):
    """Shared control state is unreadable or cannot be safely persisted."""


class DailyBudgetExceededError(RuntimeError):
    """The daily reservation limit has been reached."""


class FileLock:
    """Exclusive, cancellation-safe lock for both sync and async callers."""

    def __init__(self, path: Path):
        self.path = path
        self._fd: int | None = None

    def _open(self) -> None:
        if self._fd is not None:
            raise RuntimeError("FileLock is not reentrant")
        try:
            self._fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        except OSError as error:
            raise CoordinationError(f"Cannot open bridge lock {self.path}") from error

    def _try_acquire(self) -> bool:
        assert self._fd is not None
        try:
            if os.name == "nt":
                import msvcrt

                # Windows permits locking beyond EOF; the file need not contain
                # a byte. Locking a fixed region avoids initialization races.
                os.lseek(self._fd, 0, os.SEEK_SET)
                msvcrt.locking(self._fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                return False
            raise CoordinationError(f"Cannot acquire bridge lock {self.path}") from error

    def _close(self) -> None:
        if self._fd is not None:
            # Closing releases either OS lock, also on exceptions/cancellation.
            os.close(self._fd)
            self._fd = None

    def __enter__(self) -> FileLock:
        self._open()
        try:
            while not self._try_acquire():
                time.sleep(0.05)
            return self
        except BaseException:
            self._close()
            raise

    def __exit__(self, *args) -> None:
        self._close()

    async def __aenter__(self) -> FileLock:
        self._open()
        try:
            while not self._try_acquire():
                # No background lock-acquisition thread can outlive a cancelled
                # waiter and take a lock that nobody will subsequently release.
                await asyncio.sleep(0.05)
            return self
        except BaseException:
            self._close()
            raise

    async def __aexit__(self, *args) -> None:
        self._close()


class SharedCallCoordinator:
    """One coordination domain per budget file, shared by all bridge processes."""

    def __init__(self, state_path: Path):
        self.state_path = state_path.resolve()
        self.state_lock_path = Path(f"{self.state_path}.lock")
        self.call_lock_path = Path(f"{self.state_path}.calls.lock")

    def _load(self) -> dict:
        """Called with the state lock held. Never reset malformed state."""
        today = datetime.now().date().isoformat()
        try:
            raw = self.state_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {
                "version": 1, "date": today, "count": 0,
                "last_call_at": 0.0, "in_flight": False,
            }
        except (OSError, UnicodeError) as error:
            raise CoordinationError(f"Cannot read bridge state {self.state_path}") from error

        try:
            state = json.loads(raw)
            if not isinstance(state, dict):
                raise ValueError("expected an object")
            stored_date = state["date"]
            if not isinstance(stored_date, str) or date.fromisoformat(stored_date).isoformat() != stored_date:
                raise ValueError("invalid budget date")
            if type(state["count"]) is not int or state["count"] < 0:
                raise ValueError("invalid budget count")
            if "version" not in state:
                # The previous format contained exactly these two fields. Its
                # counter is preserved when first adopting shared coordination.
                if set(state) != {"date", "count"}:
                    raise ValueError("unrecognized legacy state")
                state.update(version=1, last_call_at=0.0, in_flight=False)
            if type(state["version"]) is not int or state["version"] != 1:
                raise ValueError("unsupported state version")
            if (
                type(state["last_call_at"]) not in (int, float)
                or not math.isfinite(state["last_call_at"])
                or state["last_call_at"] < 0
                or type(state["in_flight"]) is not bool
            ):
                raise ValueError("invalid call timing")
            if stored_date > today:
                raise ValueError("budget date is in the future; check the local clock")
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            raise CoordinationError(
                f"Invalid bridge state in {self.state_path}; refusing to reset its budget. "
                "Inspect and recover the state before making more calls."
            ) from error

        if stored_date < today:
            # Daily usage rolls over; call timing and interrupted-call recovery
            # remain shared across midnight.
            state.update(date=today, count=0)
        return state

    def _save(self, state: dict) -> None:
        """Persist a complete reservation before any upstream call can start."""
        temporary: Path | None = None
        try:
            payload = json.dumps(state, allow_nan=False)
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.state_path.parent,
                prefix=f"{self.state_path.name}.", suffix=".tmp", delete=False,
            ) as handle:
                temporary = Path(handle.name)
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.state_path)
            temporary = None
            if os.name != "nt":
                # Persist the replacement directory entry on POSIX. Windows
                # does not expose directory fsync through this standard API.
                directory_fd = os.open(self.state_path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        except (OSError, ValueError, TypeError) as error:
            raise CoordinationError(
                f"Cannot persist bridge state {self.state_path}; further work is blocked."
            ) from error
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

    @staticmethod
    def _increment(state: dict, limit: int, enabled: bool) -> None:
        if not enabled:
            return
        if state["count"] >= limit:
            raise DailyBudgetExceededError(
                f"Daily query budget ({limit}) exhausted "
                f"({state['count']} calls today, date={state['date']}). "
                "Reset is automatic on local-date change. "
                "Set BRIDGE_DAILY_QUERY_BUDGET higher or BRIDGE_DAILY_BUDGET_ENABLED=false to override."
            )
        state["count"] += 1

    def budget_status(self, limit: int, enabled: bool) -> dict:
        with FileLock(self.state_lock_path):
            state = self._load()
        return {
            "enabled": enabled, "limit": limit, "count_today": state["count"],
            "remaining": max(0, limit - state["count"]), "date": state["date"],
        }

    def reserve_budget(self, limit: int, enabled: bool) -> None:
        if not enabled:
            return
        with FileLock(self.state_lock_path):
            state = self._load()
            self._increment(state, limit, enabled)
            self._save(state)

    def _remaining_cooldown(self, interval: float) -> float:
        with FileLock(self.state_lock_path):
            state = self._load()
            now = time.time()
            if state["in_flight"]:
                # We hold the exclusive call lock, so the previous owner has
                # exited without recording completion. Keep its reservation and
                # wait a full interval from recovery, never assume it made no call.
                state.update(last_call_at=now, in_flight=False)
                self._save(state)
            return max(0.0, state["last_call_at"] + interval - now)

    def _begin_call(self, limit: int, enabled: bool) -> None:
        with FileLock(self.state_lock_path):
            state = self._load()
            self._increment(state, limit, enabled)
            state["in_flight"] = True
            self._save(state)

    def _finish_call(self) -> None:
        with FileLock(self.state_lock_path):
            state = self._load()
            state.update(last_call_at=time.time(), in_flight=False)
            self._save(state)

    @asynccontextmanager
    async def call(
        self, *, interval: float, budget_limit: int, budget_enabled: bool,
        check_allowed: Callable[[], None],
    ):
        if not math.isfinite(interval) or interval < 0:
            raise ValueError("Call interval must be finite and nonnegative")
        async with FileLock(self.call_lock_path):
            check_allowed()
            while (remaining := self._remaining_cooldown(interval)) > 0:
                await asyncio.sleep(remaining)
            # Operating hours/date may have changed while waiting for a lock or
            # cooldown. Reserve against the current local day, immediately before
            # yielding to the upstream operation.
            check_allowed()
            self._begin_call(budget_limit, budget_enabled)
            try:
                yield
            finally:
                # This also runs for provider errors and asyncio cancellation.
                # Persist failures propagate, rather than triggering an API retry.
                self._finish_call()

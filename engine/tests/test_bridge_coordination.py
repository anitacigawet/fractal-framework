"""Inert regression tests: all files and calls are synthetic, no login required.

Run from engine/: python -B -m unittest discover -s tests -p 'test_*.py' -v
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import multiprocessing
import os
import tempfile
import time
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from notebooklm_bridge import client, runner
from notebooklm_bridge.coordination import (
    CoordinationError,
    DailyBudgetExceededError,
    FileLock,
    SharedCallCoordinator,
)


def _budget_worker(path, ready, results):
    coordinator = SharedCallCoordinator(Path(path))
    ready.wait(10)
    accepted = 0
    rejected = 0
    for _ in range(10):
        try:
            coordinator.reserve_budget(17, True)
            accepted += 1
        except DailyBudgetExceededError:
            rejected += 1
    results.put((accepted, rejected))


def _call_worker(path, ready, results):
    async def run():
        coordinator = SharedCallCoordinator(Path(path))
        for _ in range(2):
            async with coordinator.call(
                interval=0.15, budget_limit=20, budget_enabled=True,
                check_allowed=lambda: None,
            ):
                started = time.time()
                await asyncio.sleep(0.08)
                finished = time.time()
            results.put((started, finished))
    ready.wait(10)
    asyncio.run(run())


def _interrupted_call_worker(path, ready):
    async def run():
        async with SharedCallCoordinator(Path(path)).call(
            interval=0, budget_limit=20, budget_enabled=True,
            check_allowed=lambda: None,
        ):
            ready.set()
            await asyncio.sleep(60)
    asyncio.run(run())


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="fractal-bridge-test-")
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "budget.json"
        self.coordinator = SharedCallCoordinator(self.path)

    def test_legacy_budget_migrates_without_losing_usage(self):
        today = datetime.now().date().isoformat()
        self.path.write_text(json.dumps({"date": today, "count": 4}), encoding="utf-8")
        self.coordinator.reserve_budget(5, True)
        with self.assertRaises(DailyBudgetExceededError):
            SharedCallCoordinator(self.path).reserve_budget(5, True)
        self.assertEqual(self.coordinator.budget_status(5, True), {
            "enabled": True, "limit": 5, "count_today": 5,
            "remaining": 0, "date": today,
        })
        state = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(state["version"], 1)

    def test_rollover_preserves_call_timing(self):
        yesterday = (datetime.now().date() - timedelta(days=1)).isoformat()
        state = {
            "version": 1, "date": yesterday, "count": 17,
            "last_call_at": time.time(), "in_flight": True,
        }
        self.path.write_text(json.dumps(state), encoding="utf-8")
        self.coordinator.reserve_budget(17, True)
        updated = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(updated["count"], 1)
        self.assertEqual(updated["last_call_at"], state["last_call_at"])
        self.assertTrue(updated["in_flight"])

    def test_corrupt_and_future_state_never_resets(self):
        today = datetime.now().date().isoformat()
        tomorrow = (datetime.now().date() + timedelta(days=1)).isoformat()
        invalid = [
            "{", "null", "[]", "{}",
            json.dumps({"date": today, "count": -1}),
            json.dumps({"date": today, "count": True}),
            json.dumps({"date": "2000-01-01", "count": "17"}),
            json.dumps({"date": "invalid", "count": 0}),
            json.dumps({"date": tomorrow, "count": 0}),
            json.dumps({"date": today, "count": 0, "version": 1}),
            json.dumps({"date": today, "count": 0, "version": 2,
                        "last_call_at": 0, "in_flight": False}),
            json.dumps({"date": today, "count": 0, "version": 1,
                        "last_call_at": float("nan"), "in_flight": False}),
            json.dumps({"date": today, "count": 0, "version": 1,
                        "last_call_at": 0, "in_flight": "false"}),
        ]
        for contents in invalid:
            with self.subTest(contents=contents):
                self.path.write_text(contents, encoding="utf-8")
                with self.assertRaises(CoordinationError):
                    self.coordinator.reserve_budget(100, True)
                with self.assertRaises(CoordinationError):
                    self.coordinator.budget_status(100, True)
                self.assertEqual(self.path.read_text(encoding="utf-8"), contents)

    def test_atomic_replace_failure_preserves_previous_counter(self):
        self.coordinator.reserve_budget(100, True)
        before = self.path.read_bytes()
        with patch("notebooklm_bridge.coordination.os.replace", side_effect=PermissionError("synthetic")):
            with self.assertRaises(CoordinationError):
                self.coordinator.reserve_budget(100, True)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob("*.tmp")), [])

    def test_sync_client_budget_api_uses_same_state(self):
        with patch.object(client, "_BUDGET_FILE", self.path), \
             patch.object(client, "_DAILY_QUERY_BUDGET", 2), \
             patch.object(client, "_DAILY_BUDGET_ENABLED", True):
            client._check_and_increment_budget()
            client._check_and_increment_budget()
            self.assertEqual(client.get_budget_status()["count_today"], 2)
            with self.assertRaises(client.DailyBudgetExceededError):
                client._check_and_increment_budget()

    def test_disabled_budget_does_not_consume_reservations(self):
        self.coordinator.reserve_budget(0, False)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.coordinator.budget_status(0, False)["count_today"], 0)

    def _processes(self, worker, count, *args):
        context = multiprocessing.get_context("spawn")
        children = [context.Process(target=worker, args=args) for _ in range(count)]
        for child in children:
            child.start()
        def cleanup():
            for child in children:
                if child.is_alive():
                    child.terminate()
                child.join(5)
                child.close()
        self.addCleanup(cleanup)
        return children

    def test_multiprocess_budget_cannot_lose_or_overspend_reservations(self):
        context = multiprocessing.get_context("spawn")
        ready, results = context.Event(), context.Queue()
        children = self._processes(_budget_worker, 4, str(self.path), ready, results)
        ready.set()
        counts = [results.get(timeout=15) for _ in children]
        for child in children:
            child.join(5)
            self.assertEqual(child.exitcode, 0)
        self.assertEqual(sum(accepted for accepted, _ in counts), 17)
        self.assertEqual(sum(rejected for _, rejected in counts), 23)
        self.assertEqual(self.coordinator.budget_status(17, True)["count_today"], 17)
        results.close()
        results.join_thread()

    def test_multiprocess_calls_serialize_and_share_completion_cooldown(self):
        context = multiprocessing.get_context("spawn")
        ready, results = context.Event(), context.Queue()
        children = self._processes(_call_worker, 3, str(self.path), ready, results)
        ready.set()
        calls = sorted(results.get(timeout=15) for _ in range(6))
        for child in children:
            child.join(5)
            self.assertEqual(child.exitcode, 0)
        for previous, current in zip(calls, calls[1:]):
            self.assertGreaterEqual(current[0] - previous[1], 0.14)
        self.assertEqual(self.coordinator.budget_status(20, True)["count_today"], 6)
        results.close()
        results.join_thread()

    def test_process_death_releases_lock_and_preserves_reservation(self):
        context = multiprocessing.get_context("spawn")
        ready = context.Event()
        child = self._processes(_interrupted_call_worker, 1, str(self.path), ready)[0]
        self.assertTrue(ready.wait(10))
        child.terminate()
        child.join(5)
        self.assertFalse(child.is_alive())

        async def recover():
            began_waiting = time.time()
            async with self.coordinator.call(
                interval=0.15, budget_limit=20, budget_enabled=True,
                check_allowed=lambda: None,
            ):
                self.assertGreaterEqual(time.time() - began_waiting, 0.14)
                self.assertEqual(self.coordinator.budget_status(20, True)["count_today"], 2)
        asyncio.run(self._bounded(recover()))

    @staticmethod
    async def _bounded(awaitable):
        return await asyncio.wait_for(awaitable, timeout=3)


class ClientGuardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="fractal-client-test-")
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "budget.json"
        self.patches = ExitStack()
        self.addCleanup(self.patches.close)
        self.patches.enter_context(patch.object(client, "_OPERATING_HOURS_ENABLED", False))
        self.patches.enter_context(patch.object(client, "_DAILY_BUDGET_ENABLED", True))
        self.patches.enter_context(patch.object(client, "_DAILY_QUERY_BUDGET", 100))
        self.patches.enter_context(patch.object(client.random, "uniform", return_value=0))
        self.bridge = client.BridgeNotebookLMClient(0, budget_file=self.path)
        self.api = SimpleNamespace(
            notebooks=SimpleNamespace(create=AsyncMock(return_value=SimpleNamespace(id="synthetic"))),
            sources=SimpleNamespace(add_url=AsyncMock(), add_file=AsyncMock(), list=AsyncMock(return_value=[])),
            research=SimpleNamespace(start=AsyncMock(return_value={"task_id": "synthetic"}),
                                     poll=AsyncMock(return_value={}), import_sources=AsyncMock(return_value={})),
            chat=SimpleNamespace(configure=AsyncMock(), ask=AsyncMock(return_value=SimpleNamespace(answer="synthetic"))),
        )
        # Deliberately never call open(): no provider library or saved session.
        self.bridge._client = self.api

    async def test_every_wrapper_operation_reserves_budget_including_source_listing(self):
        fake_module = SimpleNamespace(
            ChatGoal=SimpleNamespace(CUSTOM="custom"),
            ChatResponseLength=SimpleNamespace(LONGER="longer"),
        )
        with patch.dict("sys.modules", {"notebooklm": fake_module}):
            await self.bridge.create_notebook("synthetic")
            await self.bridge.add_url_source("synthetic", "https://example.invalid")
            await self.bridge.add_file_source("synthetic", "unused-file")
            await self.bridge.list_sources("synthetic")
            await self.bridge.start_deep_research("synthetic", "synthetic")
            await self.bridge.poll_research("synthetic")
            await self.bridge.import_research_sources("synthetic", "synthetic", [])
            await self.bridge.configure_prompt("synthetic", "synthetic")
            await self.bridge.query("synthetic", "synthetic")
        self.assertEqual(self.bridge._coordinator.budget_status(100, True)["count_today"], 9)
        with patch.object(client, "_DAILY_QUERY_BUDGET", 9):
            with self.assertRaises(DailyBudgetExceededError):
                await self.bridge.list_sources("synthetic")
        self.api.sources.list.assert_awaited_once()

    async def test_source_listing_runner_does_not_use_underlying_client(self):
        fake = SimpleNamespace(open=AsyncMock(), close=AsyncMock(), list_sources=AsyncMock(return_value=[
            SimpleNamespace(id="one", title="Synthetic source", url="https://example.invalid")
        ]))
        output = io.StringIO()
        with patch.object(runner, "BridgeNotebookLMClient", return_value=fake), redirect_stdout(output):
            result = await runner.cmd_list_sources(argparse.Namespace(notebook_id="synthetic"))
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())[0]["id"], "one")
        fake.list_sources.assert_awaited_once_with("synthetic")
        fake.close.assert_awaited_once()

    async def test_corruption_blocks_upstream_even_when_budget_disabled(self):
        self.path.write_text("not json", encoding="utf-8")
        with patch.object(client, "_DAILY_BUDGET_ENABLED", False):
            with self.assertRaises(CoordinationError):
                await self.bridge.list_sources("synthetic")
        self.api.sources.list.assert_not_awaited()

    async def test_failed_reservation_never_starts_upstream(self):
        for operation in ("tempfile.NamedTemporaryFile", "os.fsync", "os.replace"):
            with self.subTest(operation=operation):
                with patch(f"notebooklm_bridge.coordination.{operation}", side_effect=OSError("synthetic disk failure")):
                    with self.assertRaises(CoordinationError):
                        await self.bridge.list_sources("synthetic")
        self.api.sources.list.assert_not_awaited()

    async def test_unreadable_state_never_starts_upstream(self):
        with patch.object(Path, "read_text", side_effect=PermissionError("synthetic read failure")):
            with self.assertRaises(CoordinationError):
                await self.bridge.list_sources("synthetic")
        self.api.sources.list.assert_not_awaited()

    async def test_failed_completion_write_does_not_retry_a_successful_query(self):
        replace = os.replace
        attempts = 0
        def fail_second_replace(*args):
            nonlocal attempts
            attempts += 1
            if attempts == 2:
                raise OSError("synthetic completion failure")
            return replace(*args)
        with patch("notebooklm_bridge.coordination.os.replace", side_effect=fail_second_replace):
            with self.assertRaises(CoordinationError):
                await self.bridge.query("synthetic", "synthetic")
        self.api.chat.ask.assert_awaited_once()
        state = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(state["count"], 1)
        self.assertTrue(state["in_flight"])

    async def test_each_failed_query_attempt_keeps_its_reservation(self):
        self.api.chat.ask.side_effect = [RuntimeError("synthetic"), SimpleNamespace(answer="ok")]
        with patch.object(client, "_BACKOFF_BASE", 0):
            self.assertEqual(await self.bridge.query("synthetic", "synthetic"), "ok")
        self.assertEqual(self.bridge._coordinator.budget_status(100, True)["count_today"], 2)
        self.assertFalse(json.loads(self.path.read_text(encoding="utf-8"))["in_flight"])

    async def test_fresh_client_observes_previous_client_completion(self):
        await self.bridge.list_sources("synthetic")
        finished = time.time()
        other = client.BridgeNotebookLMClient(0.15, budget_file=self.path)
        other._client = self.api
        await other.list_sources("synthetic")
        self.assertGreaterEqual(time.time() - finished, 0.14)

    async def test_operating_hours_checked_again_after_wait(self):
        await self.bridge.list_sources("synthetic")
        self.bridge._cooldown = 0.05
        with patch.object(client, "_check_operating_hours", side_effect=[None, client.OutsideOperatingHoursError("synthetic")]):
            with self.assertRaises(client.OutsideOperatingHoursError):
                await self.bridge.list_sources("synthetic")
        self.api.sources.list.assert_awaited_once()
        self.assertEqual(self.bridge._coordinator.budget_status(100, True)["count_today"], 1)

    async def test_cancelled_call_records_completion_and_releases_lock(self):
        started = asyncio.Event()
        async def pending_call(*args):
            started.set()
            await asyncio.sleep(60)
        self.api.sources.list.side_effect = pending_call
        task = asyncio.create_task(self.bridge.list_sources("synthetic"))
        await asyncio.wait_for(started.wait(), timeout=2)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        state = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(state["count"], 1)
        self.assertFalse(state["in_flight"])
        self.api.sources.list.side_effect = None
        await asyncio.wait_for(self.bridge.list_sources("synthetic"), timeout=2)

    async def test_cancelled_lock_waiter_does_not_leave_a_background_lock(self):
        lock_path = self.path.parent / "synthetic.lock"
        async def acquire():
            async with FileLock(lock_path):
                return True
        async with FileLock(lock_path):
            task = asyncio.create_task(acquire())
            await asyncio.sleep(0.05)
            self.assertFalse(task.done())
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertTrue(await asyncio.wait_for(acquire(), timeout=2))


if __name__ == "__main__":
    unittest.main()

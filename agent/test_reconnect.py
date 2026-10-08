import ast
import asyncio
from pathlib import Path
import unittest
from unittest.mock import AsyncMock

from reconnect import ReconnectGrace


class ReconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_participant_refresh_keeps_existing_session_and_context(self):
        expire = AsyncMock()
        grace = ReconnectGrace("participant-owned", expire, seconds=0.03)
        self.assertTrue(grace.disconnected("participant-owned"))
        await asyncio.sleep(0)
        self.assertTrue(grace.connected("participant-owned"))
        await asyncio.sleep(0.04)
        expire.assert_not_awaited()
        await grace.close()

    async def test_another_identity_cannot_extend_the_owned_session(self):
        expire = AsyncMock()
        grace = ReconnectGrace("participant-owned", expire, seconds=0.01)
        self.assertFalse(grace.disconnected("participant-other"))
        self.assertTrue(grace.disconnected("participant-owned"))
        self.assertFalse(grace.connected("participant-other"))
        await asyncio.sleep(0.03)
        expire.assert_awaited_once()
        self.assertFalse(grace.connected("participant-owned"))
        await grace.close()

    async def test_repeated_disconnect_does_not_extend_the_deadline(self):
        expire = AsyncMock()
        grace = ReconnectGrace("participant-owned", expire, seconds=0.015)
        grace.disconnected("participant-owned")
        task = grace._task
        await asyncio.sleep(0)
        grace.disconnected("participant-owned")
        self.assertIs(grace._task, task)
        await asyncio.sleep(0.04)
        expire.assert_awaited_once()
        await grace.close()

    async def test_job_shutdown_cancels_pending_expiry(self):
        expire = AsyncMock()
        grace = ReconnectGrace("participant-owned", expire, seconds=0.01)
        grace.disconnected("participant-owned")
        await grace.close()
        await asyncio.sleep(0.02)
        expire.assert_not_awaited()

    def test_real_room_options_override_sdk_refresh_closure_and_demo_keeps_it(self):
        tree = ast.parse(Path(__file__).with_name("main.py").read_text(encoding="utf-8"))
        options = next(node for node in ast.walk(tree) if isinstance(node, ast.Call)
                       and isinstance(node.func, ast.Name) and node.func.id == "RoomOptions")
        expression = next(keyword.value for keyword in options.keywords
                          if keyword.arg == "close_on_disconnect")
        code = compile(ast.Expression(expression), "room_options", "eval")
        self.assertFalse(eval(code, {"real": True}))
        self.assertTrue(eval(code, {"real": False}))

    def test_session_cannot_inherit_cloud_audio_recording_without_consent(self):
        tree = ast.parse(Path(__file__).with_name("main.py").read_text(encoding="utf-8"))
        start = next(node for node in ast.walk(tree) if isinstance(node, ast.Call)
                     and isinstance(node.func, ast.Attribute) and node.func.attr == "start"
                     and isinstance(node.func.value, ast.Name) and node.func.value.id == "session")
        setting = next(keyword.value for keyword in start.keywords if keyword.arg == "record")
        self.assertIsInstance(setting, ast.Constant)
        self.assertIs(setting.value, False)

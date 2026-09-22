import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from opening import OpeningTurn


class OpeningTests(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_session_opens_without_user_input_and_reconnect_does_not_repeat(self):
        session = SimpleNamespace(generate_reply=AsyncMock())
        participant_ready = asyncio.Event()

        async def wait_for_participant():
            await participant_ready.wait()
            return SimpleNamespace(attributes={})

        opening = OpeningTurn()
        task = asyncio.create_task(opening.start(session, wait_for_participant))
        await asyncio.sleep(0)
        session.generate_reply.assert_not_called()
        participant_ready.set()
        self.assertTrue(await task)
        await opening.start(session, wait_for_participant)
        session.generate_reply.assert_awaited_once()

    async def test_replacement_job_cannot_replay_greeting_on_resume(self):
        session = SimpleNamespace(generate_reply=AsyncMock())
        wait = AsyncMock(return_value=SimpleNamespace(attributes={"qalvi.resume": "true"}))
        self.assertFalse(await OpeningTurn().start(session, wait))
        session.generate_reply.assert_not_called()

    async def test_overlapping_start_requests_cannot_duplicate_opening(self):
        session = SimpleNamespace(generate_reply=AsyncMock())
        wait = AsyncMock(return_value=SimpleNamespace(attributes={}))
        opening = OpeningTurn()
        await asyncio.gather(opening.start(session, wait), opening.start(session, wait))
        session.generate_reply.assert_awaited_once()

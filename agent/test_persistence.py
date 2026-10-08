import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from persistence import EvidenceError, EvidenceWriter, occurred_at, persist_then_continue
from turn_input import handle_text_input


class FakeAPI:
    def __init__(self):
        self.rows = {}
        self.sequence = 0
        self.calls = []
        self.fail_after_commit = False
        self.fail_before_commit = False
        self.generation = 2
        self.controls = {}
        self.fail_control = False
        self.control_ack_lost = False

    async def request(self, method, path, body=None):
        if path.startswith("/conversations?"):
            return [{"id": "conversation-1", "participant_id": "participant-1",
                     "livekit_room": "qalvi-real-00000000-0000-4000-8000-000000000001",
                     "livekit_profile_id": "primary", "status": "pending", "consented_at": occurred_at()}]
        if path.startswith("/interview_resumes?"):
            return [{"id": "resume-1"}]
        raise AssertionError(path)

    async def rpc(self, name, args):
        self.calls.append((name, args.copy()))
        if name == "claim_interview_writer_lease":
            if getattr(self, "lease_held", False):
                raise EvidenceError("Evidence database rejected the operation (409)", code="55P03")
            return {"generation": self.generation, "renewed": False, "transportGeneration": 1,
                    "openingStarted": getattr(self, "opening_started", False), "leaseExpiresAt": "later"}
        if name == "transition_interview_conversation":
            return "interrupted"
        if name == "record_interview_turn_control":
            if self.fail_control:
                raise EvidenceError("Control acknowledgement unavailable")
            old = self.controls.setdefault(args["p_message_id"], args.copy())
            if old != args:
                raise EvidenceError("Conflicting control record")
            if self.control_ack_lost:
                self.control_ack_lost = False
                raise EvidenceError("Control acknowledgement unavailable", retryable=True)
            return args["p_message_id"]
        if name not in ("append_interview_message", "append_recoverable_interview_message"):
            raise AssertionError(name)
        if args["p_writer_generation"] != self.generation:
            raise EvidenceError("Evidence database rejected the operation (403)")
        if self.fail_before_commit:
            raise EvidenceError("Evidence database acknowledgement unavailable", retryable=True)
        key = args["p_event_key"]
        if key in self.rows:
            old_args, row = self.rows[key]
            if old_args != args:
                raise EvidenceError("Evidence database rejected the operation (409)")
            return [{**row, "inserted": False}]
        row = {"message_id": f"message-{self.sequence}", "message_sequence": self.sequence,
               "inserted": True}
        self.sequence += 1
        self.rows[key] = (args.copy(), row)
        if self.fail_after_commit:
            self.fail_after_commit = False
            raise EvidenceError("Evidence database acknowledgement unavailable", retryable=True)
        return [row]


class PersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_control_ack_is_required_before_reply_and_lost_ack_retries_same_decision(self):
        api = FakeAPI()
        writer = EvidenceWriter(api, "conversation-1", 2)
        control = {"schema_version": 1, "methodology_version": "real-default-v1",
                   "signals": {"intent": "continue", "engagement": "neutral", "covered": [],
                               "partial": [], "probe": None, "ambiguous": False},
                   "decision_action": "continue", "state_sha256": "a" * 64}
        events = []

        async def save():
            result = await writer.append("voice:stable", "participant", "voice", "Hello", occurred_at())
            events.append("canonical_ack")
            return result

        async def advance(saved):
            await writer.record_control(saved.id, control)
            events.append("control_ack")
            events.append("reply_generation")

        api.control_ack_lost = True
        await persist_then_continue(save, advance)
        self.assertEqual(events, ["canonical_ack", "control_ack", "reply_generation"])
        self.assertEqual(len(api.controls), 1)
        self.assertEqual(sum(name == "record_interview_turn_control" for name, _ in api.calls), 2)
        api.fail_control = True
        with self.assertRaises(EvidenceError):
            await persist_then_continue(lambda: writer.append("voice:next", "participant", "voice",
                                                              "Next", occurred_at()), advance)
        self.assertEqual(events.count("reply_generation"), 1)

    async def test_room_mapping_and_writer_generation_are_server_derived(self):
        api = FakeAPI()
        room = "qalvi-real-00000000-0000-4000-8000-000000000001"
        with self.assertRaises(EvidenceError):
            await EvidenceWriter.claim(api, "qalvi-demo-00000000-0000-4000-8000-000000000001",
                                       "participant-participant-1", "AJ_test")
        with self.assertRaises(EvidenceError):
            await EvidenceWriter.claim(api, room, "participant-forged", "AJ_test")
        writer = await EvidenceWriter.claim(api, room, "participant-participant-1", "AJ_test")
        self.assertEqual(writer.conversation_id, "conversation-1")
        self.assertEqual(writer.generation, 2)
        self.assertEqual(api.calls[-1][1]["p_livekit_room"], room)

    async def test_writer_lease_claim_carries_job_profile_and_lease(self):
        api = FakeAPI()
        api.opening_started = True
        room = "qalvi-real-00000000-0000-4000-8000-000000000001"
        with patch.dict("os.environ", {"QALVI_LIVEKIT_PROFILE_ID": "primary"}):
            writer = await EvidenceWriter.claim(api, room, "participant-participant-1", "AJ_job", 30)
        name, args = api.calls[-1]
        self.assertEqual(name, "claim_interview_writer_lease")
        self.assertEqual((args["p_job_id"], args["p_profile_id"], args["p_lease_seconds"],
                          args["p_livekit_room"]), ("AJ_job", "primary", 30, room))
        self.assertTrue(writer.opening_started)
        self.assertEqual(writer.job_id, "AJ_job")
        with self.assertRaises(EvidenceError):
            await EvidenceWriter.claim(api, room, "participant-participant-1", "")

    async def test_a_held_lease_is_reported_distinctly_so_the_worker_leaves_quietly(self):
        api = FakeAPI()
        api.lease_held = True
        room = "qalvi-real-00000000-0000-4000-8000-000000000001"
        with self.assertRaises(EvidenceError) as raised:
            await EvidenceWriter.claim(api, room, "participant-participant-1", "AJ_second")
        self.assertEqual(raised.exception.code, "55P03")

    async def test_lifecycle_rpcs_are_fenced_by_generation_and_job(self):
        api = SimpleNamespace(calls=[])

        async def rpc(name, args):
            api.calls.append((name, args))
            return {"heartbeat_interview_writer": {"status": "in_progress", "leaseExpiresAt": "later"},
                    "mark_interview_opening": True, "end_interview_conversation": "completed",
                    "release_interview_writer": True}[name]
        api.rpc = rpc
        writer = EvidenceWriter(api, "conversation-1", 4, "AJ_job")
        self.assertEqual(await writer.heartbeat(30), "in_progress")
        self.assertTrue(await writer.mark_opening())
        self.assertTrue(writer.opening_started)
        self.assertEqual(await writer.end("completed", "interview_closed"), "completed")
        await writer.release()
        for name, args in api.calls:
            self.assertEqual(args["p_conversation_id"], "conversation-1", name)
            self.assertEqual(args["p_writer_generation"], 4, name)
        self.assertEqual(api.calls[0][1]["p_job_id"], "AJ_job")
        self.assertEqual(api.calls[2][1]["p_reason"], "interview_closed")

    async def test_worker_profile_must_match_database_transport_before_writer_claim(self):
        api = FakeAPI()
        room = "qalvi-real-00000000-0000-4000-8000-000000000001"
        with patch.dict("os.environ", {"LIVEKIT_AGENT_NAME": "qalvi-interview"}, clear=True):
            with self.assertRaises(EvidenceError):
                await EvidenceWriter.claim(api, room, "participant-participant-1", "AJ_test")
        with patch.dict("os.environ", {"QALVI_LIVEKIT_PROFILE_ID": "backup_1"}):
            with self.assertRaises(EvidenceError):
                await EvidenceWriter.claim(api, room, "participant-participant-1", "AJ_test")
        self.assertEqual(api.calls, [])
        with patch.dict("os.environ", {"QALVI_LIVEKIT_PROFILE_ID": "primary"}):
            writer = await EvidenceWriter.claim(api, room, "participant-participant-1", "AJ_test")
        self.assertEqual(writer.generation, 2)

    async def test_voice_duplicate_text_and_assistant_are_ordered_once(self):
        api = FakeAPI()
        writer = EvidenceWriter(api, "conversation-1", 2)
        when = occurred_at()
        voice = await writer.append("voice:item-1", "participant", "voice", "First answer", when)
        duplicate = await writer.append("voice:item-1", "participant", "voice", "First answer", when)
        typed = await writer.append("text:stream-1", "participant", "text", "Typed answer", when)
        assistant = await writer.append("assistant:item-2", "interviewer", "voice",
                                        "I hear you.", when, interrupted=True)
        self.assertEqual(voice.id, duplicate.id)
        self.assertEqual([voice.sequence, typed.sequence, assistant.sequence], [0, 1, 2])
        self.assertEqual(api.sequence, 3)
        self.assertTrue(api.rows["assistant:item-2"][0]["p_interrupted"])
        replacement = EvidenceWriter(api, "conversation-1", 2)
        replay = await replacement.append("voice:item-1", "participant", "voice", "First answer", when)
        self.assertFalse(replay.inserted)
        with self.assertRaises(EvidenceError):
            await writer.append("voice:item-1", "participant", "voice", "Changed answer", when)

    async def test_timeout_after_commit_retries_same_event_and_does_not_duplicate(self):
        api = FakeAPI()
        api.fail_after_commit = True
        writer = EvidenceWriter(api, "conversation-1", 2)
        saved = await writer.append("voice:item-3", "participant", "voice", "A fact", occurred_at())
        self.assertEqual(saved.sequence, 0)
        self.assertTrue(saved.inserted)  # this writer may advance after recovering its lost ack
        self.assertEqual(api.sequence, 1)
        attempts = [args for name, args in api.calls if name == "append_recoverable_interview_message"]
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0], attempts[1])

    async def test_failure_before_commit_and_stale_generation_never_create_evidence(self):
        api = FakeAPI()
        api.fail_before_commit = True
        writer = EvidenceWriter(api, "conversation-1", 2)
        when = occurred_at()
        with self.assertRaises(EvidenceError):
            await writer.append("text:stream-2", "participant", "text", "Question", when)
        self.assertEqual(api.sequence, 0)
        self.assertEqual(len([name for name, _ in api.calls if name == "append_recoverable_interview_message"]), 3)
        api.fail_before_commit = False
        api.generation = 3
        with self.assertRaises(EvidenceError):
            await writer.append("text:stream-2", "participant", "text", "Question", when)
        self.assertEqual(api.sequence, 0)


class GateTests(unittest.IsolatedAsyncioTestCase):
    async def test_typed_turn_waits_for_shared_voice_control_lock(self):
        class Claim:
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): return False
        lock = asyncio.Lock()
        await lock.acquire()  # a spoken turn owns canonical append and control decision
        session = SimpleNamespace(_claim_user_turn=lambda: Claim(), interrupt=AsyncMock(),
                                  generate_reply=Mock())
        writer = SimpleNamespace(append=AsyncMock(return_value=SimpleNamespace(
            id="saved-typed", sequence=1, inserted=True)))
        room = SimpleNamespace(local_participant=SimpleNamespace(send_text=AsyncMock()))
        agent = SimpleNamespace(_turn_lock=lock, _paused=False, _advanced_turns=set(),
                                flush_assistant=AsyncMock(), present=AsyncMock(return_value=None))
        event = SimpleNamespace(text="Typed answer", participant=SimpleNamespace(identity="participant-p1"),
                                info=SimpleNamespace(stream_id="stream-3", timestamp=1700000000000,
                                                     attributes=None))
        task = asyncio.create_task(handle_text_input(session, event, agent, writer, room, "participant-p1"))
        await asyncio.sleep(0)
        writer.append.assert_not_awaited()
        lock.release()
        await task
        writer.append.assert_awaited_once()
        agent.present.assert_awaited_once()
        session.generate_reply.assert_called_once()

    async def test_generation_waits_for_ack_and_failed_write_prevents_advance(self):
        acknowledged = asyncio.Event()
        advanced = []

        async def save():
            await acknowledged.wait()
            return "durable-message"

        async def advance(_saved):
            advanced.append("reply")

        task = asyncio.create_task(persist_then_continue(save, advance))
        await asyncio.sleep(0)
        self.assertEqual(advanced, [])
        acknowledged.set()
        self.assertEqual(await task, "durable-message")
        self.assertEqual(advanced, ["reply"])

        async def failed_save():
            raise EvidenceError("database unavailable")

        with self.assertRaises(EvidenceError):
            await persist_then_continue(failed_save, advance)
        self.assertEqual(advanced, ["reply"])

    async def test_typed_turn_acknowledges_durable_write_and_duplicate_does_not_reply(self):
        class Claim:
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): return False
        session = SimpleNamespace(_claim_user_turn=lambda: Claim(), interrupt=AsyncMock(),
                                  generate_reply=Mock())
        gate = asyncio.Event()
        async def append(*_args):
            await gate.wait()
            return SimpleNamespace(id="saved-1", sequence=0, inserted=True)
        writer = SimpleNamespace(append=AsyncMock(side_effect=append))
        room = SimpleNamespace(local_participant=SimpleNamespace(send_text=AsyncMock()))
        drained = asyncio.Event()
        async def flush_assistant():
            await drained.wait()
        agent = SimpleNamespace(_paused=False, _advanced_turns=set(),
                                flush_assistant=AsyncMock(side_effect=flush_assistant),
                                present=AsyncMock(return_value=None))
        event = SimpleNamespace(text="Typed turn", participant=SimpleNamespace(identity="participant-p1"),
                                info=SimpleNamespace(stream_id="stream-1", timestamp=1700000000000,
                                                     attributes={"qalvi.event_id": "00000000-0000-4000-8000-000000000001",
                                                                 "qalvi.event_at": occurred_at()}))
        task = asyncio.create_task(handle_text_input(session, event, agent, writer, room, "participant-p1"))
        await asyncio.sleep(0)
        writer.append.assert_not_awaited()
        drained.set()
        await asyncio.sleep(0)
        session.generate_reply.assert_not_called()
        gate.set()
        await task
        session.generate_reply.assert_called_once()
        ack = json.loads(room.local_participant.send_text.await_args.args[0])
        self.assertEqual(ack["status"], "saved")
        self.assertEqual(writer.append.await_args.args[0], "text:00000000-0000-4000-8000-000000000001")
        await handle_text_input(session, event, agent, writer, room, "participant-p1")
        session.generate_reply.assert_called_once()
        session.interrupt.assert_awaited_once()
        agent.flush_assistant.assert_awaited_once()
        agent._advanced_turns.clear()  # replacement job receiving a replayed stream
        writer.append.side_effect = None
        writer.append.return_value = SimpleNamespace(id="saved-1", sequence=0, inserted=False)
        await handle_text_input(session, event, agent, writer, room, "participant-p1")
        session.generate_reply.assert_called_once()
        self.assertEqual(session.interrupt.await_count, 2)

    async def test_typed_write_failure_pauses_and_never_generates_reply(self):
        class Claim:
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): return False
        session = SimpleNamespace(_claim_user_turn=lambda: Claim(), interrupt=AsyncMock(),
                                  generate_reply=Mock())
        writer = SimpleNamespace(append=AsyncMock(side_effect=EvidenceError("unavailable")))
        room = SimpleNamespace(local_participant=SimpleNamespace(send_text=AsyncMock()))
        agent = SimpleNamespace(_paused=False, _advanced_turns=set(), flush_assistant=AsyncMock(),
                                pause_evidence=AsyncMock())
        event = SimpleNamespace(text="Typed turn", participant=SimpleNamespace(identity="participant-p1"),
                                info=SimpleNamespace(stream_id="stream-2", timestamp=1700000000000,
                                                     attributes=None))
        await handle_text_input(session, event, agent, writer, room, "participant-p1")
        agent.pause_evidence.assert_awaited_once()
        session.generate_reply.assert_not_called()
        self.assertEqual(json.loads(room.local_participant.send_text.await_args.args[0])["status"], "failed")


if __name__ == "__main__":
    unittest.main()

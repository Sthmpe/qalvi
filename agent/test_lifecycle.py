import asyncio
import re
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from clock import InterviewClock
from conductor import Conductor
from lifecycle import RecoveryPlan, WriterHeartbeat, plan_recovery
from persistence import EvidenceError
from reconnect import ReconnectGrace
from recovery import RecoveryError, control_data, state_hash
from signals import Signals


def conversation(turns, *, tail_control=True, assistant_after_last=False):
    """Canonical rows and durable controls produced by the real conductor."""
    live = Conductor([], InterviewClock())
    messages, controls = [], []
    for index, (text, signals) in enumerate(turns):
        decision = live.turn(text, signals)
        participant = {"id": f"p{index}", "sequence": len(messages), "speaker": "participant",
                       "channel": "text", "content": text, "control_protocol_version": 1,
                       "transport_segment_id": f"text:{index}"}
        messages.append(participant)
        last = index == len(turns) - 1
        if not last or tail_control:
            controls.append({"message_id": participant["id"], **control_data(live, signals, decision)})
        if not last or assistant_after_last:
            messages.append({"id": f"a{index}", "sequence": len(messages), "speaker": "interviewer",
                             "channel": "voice", "content": f"Reply {index}", "control_protocol_version": None,
                             "transport_segment_id": f"assistant:{index}"})
    return messages, controls, live


TURNS = [("We plan on Mondays.", Signals(intent="continue", engagement="engaged")),
         ("Clients reshape most days.", Signals(intent="continue", engagement="engaged"))]


class CrashBoundaryTests(unittest.TestCase):
    def test_nothing_started_greets_once(self):
        plan = plan_recovery([], [], opening_started=False)
        self.assertTrue(plan.greet)
        self.assertEqual(plan.signal, "fresh")
        self.assertIsNone(plan.pending)

    def test_a_marked_but_unsaved_greeting_is_never_repeated(self):
        plan = plan_recovery([], [], opening_started=True)
        self.assertFalse(plan.greet)
        self.assertTrue(plan.opening_uncertain)
        self.assertEqual(plan.signal, "reply_uncertain")

    def test_saved_turn_without_control_is_answered_because_no_reply_can_have_begun(self):
        messages, controls, _ = conversation(TURNS, tail_control=False)
        plan = plan_recovery(messages, controls, opening_started=True)
        self.assertEqual(plan.pending["id"], "p1")
        self.assertEqual(plan.signal, "answering")
        self.assertFalse(plan.reply_uncertain)
        self.assertFalse(plan.greet)
        self.assertEqual(plan.conductor.turns, 1)  # only the controlled turn was replayed

    def test_controlled_turn_without_saved_reply_is_never_regenerated(self):
        messages, controls, live = conversation(TURNS, tail_control=True)
        plan = plan_recovery(messages, controls, opening_started=True)
        self.assertIsNone(plan.pending)
        self.assertTrue(plan.reply_uncertain)
        self.assertEqual(plan.signal, "reply_uncertain")
        self.assertEqual(state_hash(plan.conductor), state_hash(live))  # replayed, not reclassified

    def test_saved_reply_resumes_with_nothing_pending(self):
        messages, controls, live = conversation(TURNS, assistant_after_last=True)
        plan = plan_recovery(messages, controls, opening_started=True)
        self.assertEqual(plan.signal, "resumed")
        self.assertFalse(plan.reply_uncertain or plan.opening_uncertain or plan.greet)
        self.assertEqual(state_hash(plan.conductor), state_hash(live))

    def test_damaged_history_fails_closed(self):
        messages, controls, _ = conversation(TURNS, assistant_after_last=True)
        with self.assertRaises(RecoveryError):  # a gap in the database sequence
            plan_recovery([m for m in messages if m["sequence"] != 1], controls, True)
        with self.assertRaises(RecoveryError):  # a controlless turn that is not the tail
            plan_recovery(messages, controls[1:], True)
        with self.assertRaises(RecoveryError):  # legacy participant history
            plan_recovery([{**messages[0], "control_protocol_version": None}, *messages[1:]], controls, True)
        with self.assertRaises(RecoveryError):  # a decision that does not replay
            plan_recovery(messages, [controls[0], {**controls[1], "decision_action": "wrap up"}], True)
        with self.assertRaises(RecoveryError):  # a control whose message is missing
            plan_recovery(messages[:2], controls, True)


class HeartbeatTests(unittest.IsolatedAsyncioTestCase):
    async def run_beats(self, outcomes, *, interval=10, lease=30):
        clock = {"t": 0.0}
        calls = iter(outcomes)

        async def beat():
            outcome = next(calls)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        async def sleep(seconds):
            clock["t"] += seconds

        lost, ended = AsyncMock(), AsyncMock()
        result = await WriterHeartbeat(beat, lost, ended, interval=interval, lease=lease,
                                       clock=lambda: clock["t"], sleep=sleep).run()
        return result, lost, ended

    async def test_replaced_writer_stops_immediately(self):
        result, lost, ended = await self.run_beats(
            ["in_progress", EvidenceError("stale conversation writer", retryable=False)])
        self.assertEqual(result, "stale")
        lost.assert_awaited_once_with("stale")
        ended.assert_not_awaited()

    async def test_terminal_status_ejects_and_stops(self):
        result, lost, ended = await self.run_beats(["in_progress", "cancelled"])
        self.assertEqual(result, "cancelled")
        ended.assert_awaited_once_with("cancelled")
        lost.assert_not_awaited()

    async def test_transient_failures_are_tolerated_only_while_the_lease_could_be_ours(self):
        transient = EvidenceError("unavailable", retryable=True)
        result, lost, _ = await self.run_beats(["in_progress", transient, "in_progress", transient, transient,
                                                transient])
        self.assertEqual(result, "lease_unconfirmed")
        lost.assert_awaited_once_with("lease_unconfirmed")


class GracePresenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_present_participant_is_never_timed_out_and_a_later_departure_still_counts(self):
        present = {"value": True}
        expire = AsyncMock()
        grace = ReconnectGrace("participant-owned", expire, seconds=0.01, present=lambda: present["value"])
        grace.disconnected("participant-owned")  # out-of-order event while actually in the room
        await asyncio.sleep(0.03)
        expire.assert_not_awaited()
        present["value"] = False
        self.assertTrue(grace.disconnected("participant-owned"))
        await asyncio.sleep(0.03)
        expire.assert_awaited_once()
        await grace.close()


class WorkerWiringTests(unittest.TestCase):
    """Structural guards on main.py, which cannot be imported on this development CPU."""

    source = Path(__file__).with_name("main.py").read_text(encoding="utf-8")

    def section(self, start, end):
        return self.source[self.source.index(start):self.source.index(end, self.source.index(start))]

    def test_greeting_is_marked_durably_before_it_is_generated(self):
        branch = self.section("if writer and plan is not None:", "wait_for_opening =")
        self.assertLess(branch.index("await writer.mark_opening()"), branch.index("await opening.start("))
        self.assertIn("plan.pending", branch)
        self.assertNotIn("generate_reply", branch)  # uncertain replies are never regenerated here

    def test_a_lost_writer_never_records_an_interruption_or_deletes_the_room(self):
        lost = self.section("async def writer_lost", "async def conversation_ended")
        self.assertIn("agent.fence()", lost)
        self.assertNotIn("pause_evidence", lost)
        self.assertNotIn("delete_room", lost)

    def test_a_terminal_conversation_ejects_from_the_workers_own_project(self):
        ended = self.section("async def conversation_ended", "async def expire_refresh_grace")
        self.assertIn("await ctx.delete_room()", ended)

    def test_natural_close_completes_while_other_departures_interrupt(self):
        expiry = self.section("async def expire_refresh_grace", "reconnect_grace = ReconnectGrace(")
        self.assertIn('writer.end("completed", "interview_closed")', expiry)
        self.assertRegex(expiry, re.compile(r"else:\s+await agent\.pause_evidence\(\)"))

    def test_the_writer_claim_carries_the_job_identity(self):
        self.assertIn("ctx.job.id, LEASE_SECONDS", self.source)

    def test_no_real_interview_exit_leaves_a_connected_agent_behind(self):
        # An entrypoint that returns keeps its job connected until shutdown, so a
        # duplicate or failed worker would linger beside the real one.
        claim = self.section("except EvidenceError as exc:", "logger.info(\"[qalvi recovery] phase=writer_claimed")
        self.assertEqual(claim.count("ctx.shutdown("), 2)  # writer unavailable, integrity failure
        self.assertIn('agent.on_paused = lambda: ctx.shutdown(reason="Interview evidence paused")', self.source)
        pause = self.section("async def pause_evidence", "def fence")
        self.assertLess(pause.index("self._writer.interrupt()"), pause.index("self.on_paused()"))


if __name__ == "__main__":
    unittest.main()

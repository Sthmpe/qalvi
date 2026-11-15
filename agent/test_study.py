import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from clock import InterviewClock
from conductor import Conductor
from lifecycle import plan_recovery
from persistence import EvidenceError, EvidenceWriter
from recovery import RecoveryError, control_data, replay_conductor
from signals import Signals
from study import METHODOLOGY, StudyPlanError, build_plan, study_context, validate_visual
from turn_input import handle_text_input
from visuals import DEMO_STEPS, RESPONSE_PREFIX, describe_answer

CARDS = {"type": "comparison_cards", "id": "study-choice", "prompt": "Which fits your team?",
         "options": [{"id": "o1", "label": "Build it", "description": "In-house"},
                     {"id": "o2", "label": "Buy it", "description": "A vendor"}]}
SLIDER = {"type": "slider", "id": "study-price", "prompt": "What would you pay a month?",
          "min": 0, "max": 200, "step": 10, "initial": 50, "unit": "USD"}


def saved_plan(**overrides):
    plan = {
        "study_id": "study-1", "title": "Tool switching", "research_goal": "Why ops teams switch tools.",
        "audience": "Operations leads at small companies",
        "objectives": [
            {"id": "last_switch", "topic": "The last time they switched tools", "priority": "high"},
            {"id": "choice", "topic": "How they choose between building and buying", "priority": "high",
             "visual": CARDS},
            {"id": "price", "topic": "What a fair price feels like", "priority": "low", "visual": SLIDER},
        ],
        "assumptions": ["Teams switch after a missed deadline"],
        "updated_at": "2026-11-10T00:00:00Z",
    }
    plan.update(overrides)
    return plan


ENGAGED = Signals(intent="continue", engagement="engaged", probe=True)


def study_conductor(plan):
    return Conductor(list(plan.steps), InterviewClock(None), goal=plan.goal,
                     methodology=METHODOLOGY)


class StudyPlanTests(unittest.TestCase):
    def test_saved_study_becomes_ordered_steps_with_only_researcher_visuals(self):
        plan = build_plan(saved_plan())
        self.assertEqual([step.key for step in plan.steps], ["last_switch", "choice", "price"])
        self.assertIsNone(plan.steps[0].display)
        self.assertEqual(plan.steps[1].display["options"][1]["label"], "Buy it")
        self.assertEqual(plan.steps[2].priority, "low")
        self.assertEqual(plan.goal, "Why ops teams switch tools.")
        self.assertNotIn("Korra", json.dumps([step.topic for step in plan.steps]))
        self.assertEqual(len(plan.fingerprint), 16)
        self.assertNotEqual(plan.fingerprint, build_plan(saved_plan(research_goal="Something else")).fingerprint)

    def test_a_study_without_goal_or_objectives_cannot_drive_an_interview(self):
        for broken in (None, saved_plan(research_goal=" "), saved_plan(objectives=[]),
                       saved_plan(objectives=[{"id": "Bad Id", "topic": "x"}, {"id": "ok", "topic": " "}])):
            with self.assertRaises(StudyPlanError):
                build_plan(broken)

    def test_malformed_or_foreign_visuals_are_dropped_and_the_objective_stays_verbal(self):
        bad_visuals = [
            {**CARDS, "id": "study-other"},
            {**CARDS, "options": CARDS["options"][:1]},
            {**CARDS, "options": [{"id": "o1", "label": "No description"}, {"id": "o2", "label": "x"}]},
            {**SLIDER, "id": "study-choice", "min": 10, "max": 5},
            {"type": "html", "id": "study-choice", "prompt": "<script>alert(1)</script>"},
            {**SLIDER, "id": "study-choice", "step": True},
        ]
        for visual in bad_visuals:
            plan = build_plan(saved_plan(objectives=[{"id": "choice", "topic": "Choosing", "visual": visual}]))
            self.assertIsNone(plan.steps[0].display, visual)
        self.assertIsNotNone(validate_visual("choice", CARDS))

    def test_context_carries_goal_audience_objectives_and_unvoiced_assumptions(self):
        context = study_context(build_plan(saved_plan()))
        self.assertIn("Why ops teams switch tools", context)
        self.assertIn("Operations leads at small companies", context)
        self.assertIn("1. The last time they switched tools.", context)
        self.assertIn("Teams switch after a missed deadline", context)
        self.assertIn("Never state them", context)


class StudyConductorTests(unittest.TestCase):
    def test_conversation_only_objective_leads_and_no_later_visual_jumps_ahead(self):
        conductor = study_conductor(build_plan(saved_plan()))
        first = conductor.turn("We moved off spreadsheets last spring.", ENGAGED)
        self.assertIsNone(first.display)
        self.assertIn("Current objective: The last time they switched tools", first.guidance)
        self.assertIn("Research goal: Why ops teams switch tools. Current objective", first.guidance)
        covered = conductor.turn("It broke during month-end, so we bought a tool.",
                                 Signals(intent="continue", engagement="engaged", covered=("last_switch",)))
        self.assertEqual(covered.display["id"], "study-choice")
        self.assertIn("tap the card that fits best", covered.guidance)
        self.assertIn("simply answer aloud", covered.guidance)
        self.assertIn("choose the one card", conductor.visual_state()["action"])

    def test_spoken_answer_to_a_visual_retires_it_like_any_covered_objective(self):
        conductor = study_conductor(build_plan(saved_plan(objectives=[saved_plan()["objectives"][1]])))
        self.assertEqual(conductor.turn("Hard to say.", ENGAGED).display["id"], "study-choice")
        answered = conductor.turn("Buying, every time. We have no engineers.",
                                  Signals(intent="continue", engagement="engaged", covered=("choice",)))
        self.assertTrue(answered.clear)
        self.assertIsNone(conductor.on_screen)
        self.assertIn("wrapping up", conductor.anchor("normal"))

    def test_asking_to_see_something_finds_the_next_objective_with_a_visual(self):
        conductor = study_conductor(build_plan(saved_plan()))
        asked = conductor.turn("Can you show me anything?", Signals(intent="visuals", engagement="engaged"))
        self.assertEqual(asked.display["id"], "study-choice")
        self.assertIn("a short comparison to choose between", " ".join(
            Conductor(list(build_plan(saved_plan()).steps), InterviewClock(None)).available_visuals()))

    def test_demo_plan_is_unchanged_and_still_tapped_on_screen(self):
        conductor = Conductor(list(DEMO_STEPS), InterviewClock(None))
        self.assertEqual(conductor.methodology, "real-default-v1")
        first = conductor.turn("I plan on Mondays.", ENGAGED)
        self.assertIn("tap the card", first.guidance)
        self.assertIn("choose the one card", conductor.visual_state()["action"])
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))

    def test_study_controls_are_versioned_and_refused_by_the_default_replay(self):
        conductor = study_conductor(build_plan(saved_plan()))
        signals = ENGAGED
        decision = conductor.turn("We moved off spreadsheets.", signals)
        control = control_data(conductor, signals, decision)
        self.assertEqual(control["methodology_version"], "study-plan-v1")
        message = {"id": "m1", "sequence": 1, "speaker": "participant", "content": "We moved off spreadsheets.",
                   "control_protocol_version": 1}
        record = {"message_id": "m1", "schema_version": 1, "methodology_version": "study-plan-v1",
                  "signals": control["signals"], "decision_action": control["decision_action"],
                  "state_sha256": control["state_sha256"]}
        with self.assertRaises(RecoveryError):
            replay_conductor([message], [record])

    def test_a_replacement_worker_replays_a_study_interview_from_its_saved_plan(self):
        plan = build_plan(saved_plan())
        live = study_conductor(plan)
        turns = [("We moved off spreadsheets.", ENGAGED),
                 ("It broke at month-end.", Signals(intent="continue", engagement="engaged", covered=("last_switch",)))]
        messages, controls = [], []
        for sequence, (text, signals) in enumerate(turns):
            control = control_data(live, signals, live.turn(text, signals))
            messages.append({"id": f"m{sequence}", "sequence": sequence, "speaker": "participant",
                             "content": text, "control_protocol_version": 1})
            controls.append({"message_id": f"m{sequence}", **control})
        recovered = plan_recovery(messages, controls, True, study_conductor(plan)).conductor
        self.assertEqual(recovered.on_screen.key, "choice")
        self.assertEqual(recovered.learned, ["last_switch"])
        self.assertEqual(recovered.methodology, "study-plan-v1")
        edited = build_plan(saved_plan(objectives=saved_plan()["objectives"][1:]))
        with self.assertRaises(RecoveryError):
            plan_recovery(messages, controls, True, study_conductor(edited))


class StudyPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_plan_read_and_visual_issue_are_fenced_by_the_claimed_writer(self):
        api = SimpleNamespace(rpc=AsyncMock(side_effect=[saved_plan(), "display-1"]))
        writer = EvidenceWriter(api, "conversation-1", 3)
        self.assertEqual((await writer.read_study_plan())["study_id"], "study-1")
        await writer.issue_visual(CARDS)
        (read_name, read_args), (issue_name, issue_args) = [call.args for call in api.rpc.await_args_list]
        self.assertEqual((read_name, read_args), ("read_interview_study_plan",
                                                  {"p_conversation_id": "conversation-1", "p_writer_generation": 3}))
        self.assertEqual(issue_name, "issue_interview_visual")
        self.assertEqual(issue_args["p_definition"], CARDS)
        self.assertEqual(issue_args["p_writer_generation"], 3)

    async def test_unreadable_plan_and_failed_issue_raise(self):
        writer = EvidenceWriter(SimpleNamespace(rpc=AsyncMock(return_value=None)), "conversation-1", 1)
        with self.assertRaises(EvidenceError):
            await writer.read_study_plan()
        failing = SimpleNamespace(rpc=AsyncMock(side_effect=EvidenceError("denied")))
        with self.assertRaises(EvidenceError):
            await EvidenceWriter(failing, "conversation-1", 1).issue_visual(CARDS)

    async def test_study_control_methodology_is_accepted_and_unknown_versions_are_not(self):
        api = SimpleNamespace(rpc=AsyncMock(return_value="message-1"))
        writer = EvidenceWriter(api, "conversation-1", 1)
        control = {"schema_version": 1, "methodology_version": "study-plan-v1",
                   "signals": {}, "decision_action": "continue", "state_sha256": "a" * 64}
        await writer.record_control("message-1", control)
        self.assertEqual(api.rpc.await_args.args[1]["p_methodology_version"], "study-plan-v1")
        with self.assertRaises(EvidenceError):
            await writer.record_control("message-1", {**control, "methodology_version": "invented-v9"})


class VisualAnswerTests(unittest.IsolatedAsyncioTestCase):
    def test_answers_are_rebuilt_from_the_display_and_mismatches_are_refused(self):
        self.assertEqual(describe_answer(CARDS, {"actionId": "study-choice", "type": "comparison_cards", "optionId": "o2"}),
                         ('Chose "Buy it"', ["o2"], None))
        self.assertEqual(describe_answer(SLIDER, {"actionId": "study-price", "type": "slider", "value": 120}),
                         ("Set 120 USD", [], 120))
        choice = {"type": "multiple_choice", "id": "study-c", "prompt": "Which?", "multiple": True,
                  "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]}
        self.assertEqual(describe_answer(choice, {"actionId": "study-c", "type": "multiple_choice", "optionIds": ["a", "b"]}),
                         ('Chose "A", "B"', ["a", "b"], None))
        for display, response in [
            (CARDS, {"actionId": "study-other", "type": "comparison_cards", "optionId": "o1"}),
            (CARDS, {"actionId": "study-choice", "type": "comparison_cards", "optionId": "invented"}),
            (CARDS, {"actionId": "study-choice", "type": "slider", "value": 1}),
            (SLIDER, {"actionId": "study-price", "type": "slider", "value": 900}),
            (SLIDER, {"actionId": "study-price", "type": "slider", "value": True}),
            ({**choice, "multiple": False}, {"actionId": "study-c", "type": "multiple_choice", "optionIds": ["a", "b"]}),
            (choice, {"actionId": "study-c", "type": "multiple_choice", "optionIds": ["a", "a"]}),
            (CARDS, "not an object"),
        ]:
            self.assertIsNone(describe_answer(display, response), response)

    def _room(self, sent):
        return SimpleNamespace(local_participant=SimpleNamespace(
            send_text=AsyncMock(side_effect=lambda text, topic: sent.append((topic, json.loads(text) if topic == "qalvi.evidence" else text)))))

    def _event(self, text, visual):
        attributes = {"qalvi.event_id": "00000000-0000-4000-8000-0000000000aa"}
        if visual is not None:
            attributes["qalvi.visual"] = json.dumps(visual)
        return SimpleNamespace(text=text, participant=SimpleNamespace(identity="participant-1"),
                               info=SimpleNamespace(attributes=attributes, stream_id="s1", timestamp=1_700_000_000_000))

    def _agent(self, conductor):
        class Claim:
            async def __aenter__(self): return None
            async def __aexit__(self, *_): return False
        agent = SimpleNamespace(_paused=False, _advanced_turns=set(), _conductor=conductor,
                                flush_assistant=AsyncMock(), pause_evidence=AsyncMock(),
                                present=AsyncMock(return_value="guidance"), mark_evidence_ack=Mock())
        session = SimpleNamespace(_claim_user_turn=lambda: Claim(), interrupt=AsyncMock(), generate_reply=Mock())
        return agent, session

    async def test_a_tapped_answer_is_saved_as_structured_evidence_before_the_reply(self):
        conductor = study_conductor(build_plan(saved_plan(objectives=[saved_plan()["objectives"][1]])))
        conductor.turn("Hard to say.", ENGAGED)
        agent, session = self._agent(conductor)
        order, sent = [], []
        writer = SimpleNamespace(
            acknowledge_visual=AsyncMock(side_effect=lambda action: order.append(("render", action))),
            append_visual_answer=AsyncMock(side_effect=lambda *args: order.append(("answer", args[1:3], args[4], args[5]))
                                           or SimpleNamespace(id="message-9", sequence=4, inserted=True)))
        agent.present.side_effect = lambda *args: order.append(("present", args[0])) or "guidance"
        await handle_text_input(session, self._event('[On screen] Chose "whatever the browser says"',
                                                     {"actionId": "study-choice", "type": "comparison_cards", "optionId": "o2"}),
                                agent, writer, self._room(sent), "participant-1")
        self.assertEqual(order, [("render", "study-choice"),
                                 ("answer", ("study-choice", 'Chose "Buy it"'), ["o2"], None),
                                 ("present", '[On screen] Chose "Buy it"')])
        self.assertEqual(writer.append_visual_answer.await_args.args[0], "visual:00000000-0000-4000-8000-0000000000aa")
        self.assertEqual(sent, [("qalvi.evidence", {"eventId": "00000000-0000-4000-8000-0000000000aa", "status": "saved",
                                                    "messageId": "message-9", "sequence": 4})])
        session.generate_reply.assert_called_once_with(user_input='[On screen] Chose "Buy it"', instructions="guidance")

    async def test_an_answer_with_no_matching_visual_on_screen_is_refused_and_writes_nothing(self):
        conductor = study_conductor(build_plan(saved_plan()))
        agent, session = self._agent(conductor)
        writer = SimpleNamespace(acknowledge_visual=AsyncMock(), append_visual_answer=AsyncMock(), append=AsyncMock())
        for visual in ({"actionId": "study-choice", "type": "comparison_cards", "optionId": "o2"}, None):
            sent = []
            await handle_text_input(session, self._event("[On screen] Chose something", visual),
                                    agent, writer, self._room(sent), "participant-1")
            self.assertEqual(sent[0][1]["status"], "failed")
        writer.append_visual_answer.assert_not_awaited()
        writer.append.assert_not_awaited()
        agent.present.assert_not_awaited()

    def test_a_saved_visual_answer_replays_with_its_on_screen_marker(self):
        plan = build_plan(saved_plan(objectives=[saved_plan()["objectives"][1]]))
        live = study_conductor(plan)
        rows, controls = [], []
        for sequence, (content, channel, signals) in enumerate([
                ("Hard to say.", "text", ENGAGED), ('Chose "Buy it"', "visual", Signals(probe=False))]):
            row = {"id": f"m{sequence}", "sequence": sequence, "speaker": "participant", "content": content,
                   "channel": channel, "control_protocol_version": 1}
            text = f"{RESPONSE_PREFIX} {content}" if channel == "visual" else content
            controls.append({"message_id": row["id"], **control_data(live, signals, live.turn(text, signals))})
            rows.append(row)
        recovered = plan_recovery(rows, controls, True, study_conductor(plan)).conductor
        self.assertTrue(recovered.answered)
        self.assertEqual(recovered.learned, ["choice"])


class VisualEvidenceOrderTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_real_visual_is_issued_before_it_is_sent_to_the_room(self):
        import main
        order = []
        writer = SimpleNamespace(
            issue_visual=AsyncMock(side_effect=lambda display: order.append(("issue", display["id"]))),
            record_control=AsyncMock(side_effect=lambda *_: order.append(("control", None))),
        )
        room = SimpleNamespace(local_participant=SimpleNamespace(
            send_text=AsyncMock(side_effect=lambda text, topic: order.append(("send", topic)))))
        plan = build_plan(saved_plan(objectives=[saved_plan()["objectives"][1]]))
        agent = main.Interviewer(room, study_conductor(plan), classifier=None, writer=writer,
                                 instructions=main.study_instructions(plan))
        with patch("main.classify", AsyncMock(return_value=ENGAGED)):
            await agent.present("Not sure yet.", SimpleNamespace(id="message-1", sequence=1))
        self.assertEqual(order, [("control", None), ("issue", "study-choice"), ("send", "qalvi.display")])


if __name__ == "__main__":
    unittest.main()

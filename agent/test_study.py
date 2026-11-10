import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from clock import InterviewClock
from conductor import Conductor
from persistence import EvidenceError, EvidenceWriter
from recovery import RecoveryError, control_data, replay_conductor
from signals import Signals
from study import METHODOLOGY, StudyPlanError, build_plan, study_context, validate_visual
from visuals import DEMO_STEPS, RESPONSE_PREFIX

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
                     methodology=METHODOLOGY, answer_in_words=True)


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
        self.assertIn("saying or typing", covered.guidance)
        self.assertNotIn("tap the card", covered.guidance)
        state = conductor.visual_state()
        self.assertIn("Nothing on it can be tapped here", state["action"])

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

import unittest

import conductor as c
from clock import InterviewClock, TimeBudget
from conductor import Conductor
from presence import check_in_allowed
from signals import Signals
from visuals import DEMO_STEPS, RESPONSE_PREFIX, VISUAL_ACTION


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


def make(budget=None):
    fake = FakeClock()
    clock = InterviewClock(budget, now=fake)
    return Conductor(list(DEMO_STEPS), clock), fake


ENGAGED = Signals(intent="continue", engagement="engaged", probe=True)


class ParticipantLeadsTests(unittest.TestCase):
    def test_engaged_participant_still_receives_visuals_in_plan_order(self):
        conductor, _ = make()
        first = conductor.turn("I plan on Mondays but it never survives.", ENGAGED)
        self.assertEqual(first.display["id"], "demo-cards")
        self.assertIn("tap the card", first.guidance)
        answer = conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        self.assertIsNone(answer.display)
        self.assertIn(c.ANSWER_RECEIVED, answer.guidance)
        self.assertIn(c.PROBE_NO, answer.guidance)
        self.assertNotIn("why", answer.guidance.split(c.PROBE_NO)[0].lower())
        second = conductor.turn("Mostly because clients change their minds.", ENGAGED)
        self.assertEqual(second.display["id"], "demo-chart")

    def test_relevance_objection_is_addressed_and_the_visual_is_removed_not_advanced(self):
        conductor, _ = make()
        conductor.turn("Fine, I suppose.", ENGAGED)
        objection = conductor.turn("Why are you asking me this? I don't see how it relates.",
                                   Signals(intent="concern", engagement="neutral"))
        self.assertIsNone(objection.display)
        self.assertTrue(objection.clear)
        self.assertIn("raised a concern", objection.guidance)
        self.assertIn("planned versus shaped", objection.guidance)
        self.assertIn("Offer to rephrase or to skip", objection.guidance)
        self.assertIn(c.NOTHING_NEW, objection.guidance)
        self.assertIsNone(conductor.on_screen)
        # The objective returns to the plan, but its visual is not pushed at them again.
        self.assertEqual([step.key for step in conductor.remaining][0], "week_shape")
        self.assertIsNone(conductor.turn("Okay, fair enough.", ENGAGED).display)
        verbal = conductor.turn("Go on.", ENGAGED)
        self.assertIsNone(verbal.display)
        self.assertIn("Current objective: How structured or reactive", verbal.guidance)
        answered = conductor.turn("Mostly planned, really.", Signals(covered=("week_shape",), probe=False))
        self.assertEqual(answered.display["id"], "demo-chart")

    def test_fatigue_shortens_the_path_to_high_priority_only(self):
        conductor, _ = make()
        conductor.turn("Okay.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "Planned in advance"', Signals(probe=False))
        tired = conductor.turn("Honestly this is getting long.", Signals(intent="fatigue"))
        self.assertIsNone(tired.display)
        self.assertIn("sounds tired", tired.guidance)
        self.assertIn("Only one short question would still be useful", tired.guidance)
        after = conductor.turn("Alright, go on.", ENGAGED)
        self.assertEqual(after.display["id"], "demo-slider")
        conductor.turn(f"{RESPONSE_PREFIX} Set 40%", Signals(probe=False))
        self.assertIsNone(conductor.turn("Yes.", ENGAGED).display)
        self.assertIn("about roughly how much of a typical day gets interrupted", tired.guidance)
        self.assertIn("Stage: narrowing", tired.guidance)

    def test_time_question_is_answered_from_real_state(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        conductor.turn("Hello.", ENGAGED)
        fake.advance(4 * 60)
        asked = conductor.turn("How much longer is this?", Signals(intent="time_left"))
        self.assertIn("About 6 minutes of the planned 10 minutes remain.", asked.guidance)
        self.assertIsNone(asked.display)
        no_budget, _ = make()
        no_budget.turn("Hello.", ENGAGED)
        asked = no_budget.turn("How long does this take?", Signals(intent="time_left"))
        self.assertIn("no fixed time limit", asked.guidance)

    def test_first_stop_may_offer_one_short_path_and_a_second_stop_closes(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        first = conductor.turn("I think I'd like to stop here.", Signals(intent="stop"))
        self.assertFalse(first.closing)
        self.assertTrue(first.clear)
        self.assertIn(c.STOP_OFFER, first.guidance)
        self.assertIsNone(first.display)
        second = conductor.turn("No, I really want to stop.", Signals(intent="stop"))
        self.assertTrue(second.closing)
        self.assertIn(c.CLOSE, second.guidance)
        self.assertNotIn(c.STOP_OFFER, second.guidance)
        later = conductor.turn("Thanks, bye.", ENGAGED)
        self.assertIsNone(later.display)
        self.assertEqual(later.guidance, c.CLOSED)

    def test_stop_with_nothing_important_left_closes_immediately(self):
        conductor, _ = make()
        for key in ("week_shape", "interruptions"):
            conductor.learned.append(key)
        conductor.remaining = [step for step in conductor.remaining if step.priority == "low"]
        decision = conductor.turn("Can we finish?", Signals(intent="stop"))
        self.assertTrue(decision.closing)

    def test_no_next_visual_after_strong_fatigue_or_stop_intent(self):
        conductor, _ = make()
        conductor.turn("Sure.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "Shaped as it goes"', Signals(probe=False))
        for intent in ("fatigue", "stop"):
            decision = conductor.turn("I'm quite tired now.", Signals(intent=intent))
            self.assertIsNone(decision.display)

    def test_declining_engagement_switches_visuals_off(self):
        conductor, _ = make()
        conductor.turn("ok", Signals(engagement="low"))
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(engagement="low", probe=False))
        flat = conductor.turn("dunno", Signals(engagement="low"))
        self.assertIsNone(flat.display)
        self.assertIn(c.LOW_ENGAGEMENT, flat.guidance)
        self.assertIsNone(conductor.turn("fine", ENGAGED).display)

    def test_already_covered_topics_are_retired_and_not_asked_again(self):
        conductor, _ = make()
        rich = Signals(intent="continue", engagement="engaged",
                       covered=("week_shape", "interruptions"), probe=False)
        decision = conductor.turn(
            "My week is mostly shaped as it goes, and honestly about half of every day is interrupted.", rich)
        self.assertEqual(decision.display["id"], "demo-chart")
        self.assertIn("Learned so far: week_shape, interruptions.", decision.guidance)
        self.assertIn("Still unresolved: day_split, causes.", decision.guidance)
        self.assertNotIn("week_shape", [step.key for step in conductor.remaining])
        self.assertNotIn("interruptions", [step.key for step in conductor.remaining])

    def test_a_covered_topic_removes_its_unanswered_visual_from_the_screen(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        decision = conductor.turn("Actually my week is completely planned in advance.",
                                  Signals(covered=("week_shape",), probe=False))
        self.assertTrue(decision.clear)
        self.assertEqual(decision.display["id"], "demo-chart")
        self.assertEqual(conductor.on_screen.key, "day_split")

    def test_skip_removes_the_visual_and_moves_on_without_pushing_another(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        skipped = conductor.turn("I'd rather not pick one.", Signals(intent="skip"))
        self.assertTrue(skipped.clear)
        self.assertIsNone(skipped.display)
        self.assertIn(c.SKIPPED, skipped.guidance)
        self.assertIsNone(conductor.turn("Go on.", ENGAGED).display)
        self.assertEqual(conductor.turn("Sure, what else?", ENGAGED).display["id"], "demo-chart")


class TimeBudgetBehaviourTests(unittest.TestCase):
    def test_focus_closing_and_over_phases_shape_the_reply_and_suppress_visuals(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        conductor.turn("Hello.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        fake.advance(7 * 60 + 30)  # 2.5 minutes left: focus
        focus = conductor.turn("Meetings mostly.", ENGAGED)
        self.assertIn(c.FOCUS, focus.guidance)
        self.assertEqual(focus.display["id"], "demo-chart")
        fake.advance(2 * 60)  # 30 seconds left: closing (minimum 60 s window)
        closing = conductor.turn("It looks about right.", ENGAGED)
        self.assertIn(c.CLOSING_PHASE, closing.guidance)
        self.assertIsNone(closing.display)
        self.assertFalse(closing.closing)
        fake.advance(60)  # over
        over = conductor.turn("And one more thing about my mornings.", ENGAGED)
        self.assertTrue(over.closing)
        self.assertIn(c.OVER, over.guidance)
        self.assertIsNone(over.display)

    def test_budget_starts_on_first_participant_turn_not_before(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        fake.advance(300)
        self.assertFalse(conductor.clock.started)
        conductor.turn("First words.", ENGAGED)
        self.assertEqual(conductor.clock.phase(), "open")
        self.assertAlmostEqual(conductor.clock.remaining(), 600)

    def test_over_budget_only_takes_effect_after_the_participant_finishes_their_turn(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        conductor.turn("Hello.", ENGAGED)
        fake.advance(601)
        self.assertEqual(conductor.clock.phase(), "over")
        self.assertFalse(conductor.closed)
        decision = conductor.turn(f'{RESPONSE_PREFIX} Chose "Planned in advance"', Signals(probe=False))
        self.assertIn(c.ANSWER_RECEIVED, decision.guidance)
        self.assertTrue(decision.closing)


class ResearchAnchorTests(unittest.TestCase):
    def test_every_note_carries_the_research_anchor(self):
        conductor, _ = make()
        conductor.goal = "how people manage their week"
        decision = conductor.turn("I run a small agency.", ENGAGED)
        self.assertTrue(decision.guidance.startswith("Action for this reply: show a relevant visual."))
        self.assertIn("Research goal: how people manage their week.", decision.guidance)
        self.assertIn("Current objective: How structured or reactive their working week usually is.", decision.guidance)
        self.assertIn("Learned so far: nothing yet.", decision.guidance)
        self.assertIn("Stage: opening", decision.guidance)

    def test_one_turn_detour_is_bridged_back_without_a_visual(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        detour = conductor.turn("Ha, that reminds me of my cat knocking my coffee over this morning.",
                                Signals(intent="detour", engagement="engaged"))
        self.assertEqual(detour.action, "acknowledge and redirect")
        self.assertIn(c.DETOUR_LIGHT, detour.guidance)
        self.assertNotIn(c.DETOUR_FIRM, detour.guidance)
        self.assertIsNone(detour.display)
        self.assertIn("Current objective: How their own working day divides", detour.guidance)
        back = conductor.turn("Right, my day is mostly meetings.", ENGAGED)
        self.assertEqual(back.display["id"], "demo-chart")

    def test_repeated_detour_gets_a_firmer_but_kind_redirection(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn("Did you see the match last night?", Signals(intent="detour"))
        second = conductor.turn("The referee was terrible, honestly.", Signals(intent="detour"))
        third = conductor.turn("And the second goal was offside.", Signals(intent="detour"))
        self.assertIn(c.DETOUR_FIRM, second.guidance)
        self.assertIn(c.DETOUR_FIRM, third.guidance)
        self.assertIn("Do not scold", third.guidance)
        self.assertIsNone(third.display)
        self.assertEqual(conductor.detour_streak, 3)
        resumed = conductor.turn("Fair enough. My week is mostly reactive.", ENGAGED)
        self.assertEqual(conductor.detour_streak, 0)
        self.assertEqual(resumed.action, "acknowledge and probe")
        self.assertEqual(conductor.on_screen.key, "week_shape")  # the pending cards are still the objective

    def test_participant_question_is_answered_briefly_then_interview_resumes(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        asked = conductor.turn("Do you think writing things down actually helps?", Signals(intent="question"))
        self.assertEqual(asked.action, "answer briefly, then redirect")
        self.assertIn(c.QUESTION, asked.guidance)
        self.assertIn("return to the current objective", asked.guidance)
        self.assertIsNone(asked.display)
        self.assertIn("Current objective: How structured or reactive", asked.guidance)
        self.assertEqual(conductor.turn("For me it helps a bit.", ENGAGED).action, "acknowledge and probe")

    def test_relevance_concern_is_handled_then_research_resumes(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        concern = conductor.turn("I don't understand how this relates.", Signals(intent="concern"))
        self.assertEqual(concern.action, "clarify")
        self.assertIn("The interview continues afterwards", concern.guidance)
        self.assertIn("Still unresolved: week_shape, day_split, interruptions, causes.", concern.guidance)
        self.assertNotIn("wrap-up", concern.guidance)
        after = conductor.turn("Okay, that makes sense now.", ENGAGED)
        self.assertEqual(after.action, "acknowledge and probe")
        self.assertIn("Current objective: How structured or reactive", after.guidance)
        resumed = conductor.turn("Mostly reactive, honestly.", Signals(covered=("week_shape",), probe=False))
        self.assertEqual(resumed.display["id"], "demo-chart")
        self.assertIn("Learned so far: week_shape.", resumed.guidance)

    def test_fatigue_compresses_objectives_without_losing_direction(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        conductor.turn("Hi.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "Planned in advance"', Signals(probe=False))
        fake.advance(240)
        tired = conductor.turn("This is getting long.", Signals(intent="fatigue"))
        self.assertEqual(tired.action, "shorten the interview")
        self.assertIn("Only one short question would still be useful, about roughly how much", tired.guidance)
        self.assertIn("About 6 minutes of the planned 10 minutes remain.", tired.guidance)
        self.assertIn("Current objective: Roughly how much of a typical day gets interrupted.", tired.guidance)
        agreed = conductor.turn("Sure, one more is fine.", ENGAGED)
        self.assertEqual(agreed.display["id"], "demo-slider")
        conductor.turn(f"{RESPONSE_PREFIX} Set 60%", Signals(probe=False))
        self.assertIn("Stage: wrap-up", conductor.turn("That's about it.", ENGAGED).guidance)

    def test_false_stop_intent_is_corrected_and_the_interview_resumes(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn("I think that's everything on that.", Signals(intent="stop"))
        self.assertEqual(conductor.stop_requests, 1)
        corrected = conductor.turn("No, I didn't say I'm done.", Signals(intent="resume", engagement="engaged"))
        self.assertEqual(corrected.action, "acknowledge and redirect")
        self.assertIn(c.RESUME, corrected.guidance)
        self.assertFalse(corrected.closing)
        self.assertFalse(conductor.closed)
        self.assertEqual(conductor.stop_requests, 0)
        self.assertFalse(conductor.shortened)
        self.assertIsNone(corrected.display)
        self.assertIn("Current objective:", corrected.guidance)
        self.assertEqual(conductor.turn("So as I was saying, my week is chaos.", ENGAGED).display["id"], "demo-cards")
        # Even after a full close, a correction reopens the interview.
        conductor.turn("Okay stop now.", Signals(intent="stop"))
        conductor.turn("Really, stop.", Signals(intent="stop"))
        self.assertTrue(conductor.closed)
        reopened = conductor.turn("Wait, no, I didn't mean stop.", Signals(intent="resume"))
        self.assertFalse(conductor.closed)
        self.assertIn(c.RESUME, reopened.guidance)
        self.assertNotEqual(reopened.guidance, c.CLOSED)

    def test_unintelligible_input_does_not_advance_anything(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        garbled = conductor.turn("uh the the fff", Signals(intent="unclear", covered=("week_shape",), probe=True))
        self.assertEqual(garbled.action, "clarify")
        self.assertIn(c.UNCLEAR, garbled.guidance)
        self.assertIsNone(garbled.display)
        self.assertFalse(conductor.clock.started)
        self.assertEqual(conductor.learned, [])
        self.assertEqual(conductor.turns, 0)
        conductor.turn("Hi.", ENGAGED)
        fake.advance(700)
        still_open = conductor.turn("mm hm kkk", Signals(intent="unclear"))
        self.assertFalse(still_open.closing)
        self.assertFalse(conductor.closed)

    def test_clear_stop_intent_still_ends_the_interview(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn("I want to stop.", Signals(intent="stop"))
        ended = conductor.turn("I really do want to stop now.", Signals(intent="stop"))
        self.assertTrue(ended.closing)
        self.assertEqual(ended.action, "wrap up")
        self.assertIn(c.CLOSE, ended.guidance)
        self.assertEqual(conductor.turn("Bye.", ENGAGED).guidance, c.CLOSED)

    def test_endless_exploration_is_cut_off_by_moving_to_the_next_objective(self):
        conductor, _ = make()
        conductor.visuals_off = True
        for _ in range(2):
            decision = conductor.turn("More about my week.", Signals(intent="continue", probe=True))
            self.assertEqual(decision.action, "acknowledge and probe")
        moved = conductor.turn("And even more about my week.", Signals(intent="continue", probe=True))
        self.assertEqual(moved.action, "move to the next objective")
        self.assertIn(c.STALLED, moved.guidance)
        self.assertNotIn(c.PROBE_YES, moved.guidance)
        self.assertEqual(conductor.remaining[0].key, "day_split")


class VisualsAreToolsTests(unittest.TestCase):
    """A visual is a tool the interviewer may still reach for, not a step to tick off."""

    def test_a_topic_touched_in_words_keeps_its_visual(self):
        conductor, _ = make()
        vague = Signals(intent="continue", engagement="engaged", partial=("week_shape",), probe=True)
        decision = conductor.turn("A bit of both really, it depends on the week.", vague)
        self.assertEqual(decision.display["id"], "demo-cards")
        self.assertIn("weigh a few alternatives", decision.guidance)
        self.assertIn("instead of repeating the question", decision.guidance)
        self.assertIn("Touched but not settled: week_shape.", decision.guidance)
        self.assertEqual(conductor.learned, [])
        answered = conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        self.assertEqual(conductor.learned, ["week_shape"])
        self.assertEqual(conductor.partly, [])
        self.assertNotIn("Touched but not settled", answered.guidance)

    def test_sufficient_evidence_retires_the_visual_that_a_partial_answer_keeps(self):
        settled, _ = make()
        decision = settled.turn("Entirely planned. I block the whole week out every Friday.",
                                Signals(covered=("week_shape",), probe=False))
        self.assertNotEqual(decision.display["id"], "demo-cards")
        self.assertNotIn("week_shape", [step.key for step in settled.remaining])
        self.assertEqual(settled.partly, [])
        touched, _ = make()
        vague = touched.turn("Depends, honestly.", Signals(partial=("week_shape",)))
        self.assertEqual(vague.display["id"], "demo-cards")

    def test_partial_answers_across_the_interview_still_leave_visuals_usable(self):
        conductor, _ = make()
        shown = []
        turns = [
            ("A mix, I suppose.", Signals(engagement="engaged", partial=("week_shape",), probe=True)),
            (f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False)),
            ("Mostly meetings and messages.", Signals(engagement="engaged", partial=("day_split",), probe=True)),
            (f"{RESPONSE_PREFIX} Set meetings closer to 50", Signals(probe=False)),
            ("I get interrupted a fair bit.", Signals(engagement="engaged", partial=("interruptions",), probe=True)),
        ]
        for text, signals in turns:
            decision = conductor.turn(text, signals)
            if decision.display:
                shown.append(decision.display["id"])
        self.assertEqual(shown, ["demo-cards", "demo-chart", "demo-slider"])
        self.assertEqual(conductor.learned, ["week_shape", "day_split"])
        self.assertEqual(conductor.partly, ["interruptions"])

    def test_explicit_interest_surfaces_a_visual_that_was_set_aside(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn("Why does any of this matter?", Signals(intent="concern"))
        self.assertIn("week_shape", conductor.verbal_only)
        asked = conductor.turn("Weren't you going to show me something to pick from?",
                               Signals(intent="visuals", engagement="engaged"))
        self.assertEqual(asked.display["id"], "demo-cards")
        self.assertEqual(asked.action, "show a relevant visual")
        self.assertIn(c.TOOLS_SHOWING, asked.guidance)
        self.assertNotIn("week_shape", conductor.verbal_only)

    def test_a_quiet_spell_does_not_make_qalvi_deny_having_visuals(self):
        conductor, _ = make()
        conductor.turn("ok", Signals(engagement="low"))
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(engagement="low", probe=False))
        conductor.turn("dunno", Signals(engagement="low"))
        self.assertTrue(conductor.visuals_off)
        asked = conductor.turn("You didn't bring any chart or selection, why?", Signals(intent="visuals"))
        self.assertFalse(conductor.visuals_off)
        self.assertEqual(asked.display["id"], "demo-slider")
        self.assertNotIn(c.LOW_ENGAGEMENT, asked.guidance)

    def test_a_visual_already_on_screen_is_pointed_at_rather_than_denied(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        asked = conductor.turn("Is there anything you can actually show me?", Signals(intent="visuals"))
        self.assertIsNone(asked.display)
        self.assertIn(c.TOOLS_ON_SCREEN, asked.guidance)
        self.assertEqual(conductor.on_screen.key, "week_shape")

    def test_near_the_end_qalvi_names_its_tools_instead_of_launching_one(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        conductor.turn("Hello.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        fake.advance(9 * 60 + 40)
        asked = conductor.turn("Why no chart this time?", Signals(intent="visuals"))
        self.assertIsNone(asked.display)
        self.assertIn("a simple chart, a slider, or a list of choices", asked.guidance)
        self.assertIn("Do not say you have none.", asked.guidance)
        self.assertNotIn(c.TOOLS_NONE, asked.guidance)
        self.assertIn(c.CLOSING_PHASE, asked.guidance)

    def test_with_nothing_useful_left_qalvi_says_so_without_inventing_one(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.learned = [step.key for step in conductor.steps]
        conductor.remaining, conductor.on_screen, conductor.answered = [], None, True
        asked = conductor.turn("Do you ever put anything on screen?", Signals(intent="visuals"))
        self.assertIsNone(asked.display)
        self.assertIn(c.TOOLS_NONE, asked.guidance)
        self.assertIn("nothing useful is left", asked.guidance)

    def test_wrap_up_does_not_launch_a_visual_to_prove_the_feature(self):
        conductor, fake = make(TimeBudget(max_duration=600))
        conductor.turn("Hello.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "Shaped as it goes"', Signals(probe=False))
        fake.advance(9 * 60 + 40)
        closing = conductor.turn("Mostly client messages, to be honest.", ENGAGED)
        self.assertIsNone(closing.display)
        self.assertIn(c.CLOSING_PHASE, closing.guidance)
        fake.advance(60)
        over = conductor.turn("Fair enough.", Signals(intent="visuals"))
        self.assertIsNone(over.display)
        self.assertTrue(over.closing)
        self.assertIn(c.OVER, over.guidance)


class ActiveVisualTests(unittest.TestCase):
    """The conductor's view of the screen must match what the participant is looking at."""

    def test_a_waiting_visual_is_carried_into_every_later_reply(self):
        conductor, _ = make()
        shown = conductor.turn("Hi.", ENGAGED)
        self.assertEqual(shown.display["id"], "demo-cards")
        self.assertTrue(conductor.pending_visual())
        # The introducing turn already explains it; every turn after carries the state.
        self.assertNotIn(c.ON_SCREEN_WAITING.split("{")[0], shown.guidance)
        asked = conductor.turn("What is this card for?", Signals(intent="visuals"))
        for fragment in ("can see a short comparison to choose between on screen right now",
                         'Which of these feels closest to how your week runs?',
                         "have not answered it yet", "Never say there is nothing on screen"):
            self.assertIn(fragment, asked.guidance)
        self.assertNotIn("comparison_cards", asked.guidance)
        # Even a garbled turn keeps the screen state, because the screen has not changed.
        garbled = conductor.turn("mm the the", Signals(intent="unclear"))
        self.assertIn("have not answered it yet", garbled.guidance)

    def test_an_answered_visual_is_still_known_and_not_asked_for_again(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        self.assertFalse(conductor.pending_visual())
        self.assertEqual(conductor.visual_state()["key"], "week_shape")
        # An ordinary later turn still carries the confirmed visual into the reply context.
        later = conductor.turn("Anyway, Mondays are the worst.", Signals(intent="detour"))
        self.assertIn(c.ON_SCREEN_DONE.split("{")[0], later.guidance)
        self.assertIn("already answered it", later.guidance)
        self.assertIn("refer to what they already chose", later.guidance)
        self.assertNotIn("have not answered it yet", later.guidance)

    def test_asking_about_an_answered_visual_explains_it_rather_than_denying_it(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        asked = conductor.turn("Why was that card there?", Signals(intent="visuals"))
        self.assertIn("a short comparison to choose between", asked.guidance)
        self.assertIn("Which of these feels closest to how your week runs?", asked.guidance)
        self.assertIn("what it was for", asked.guidance)
        self.assertIn("refer to what they chose rather than asking again", asked.guidance)
        self.assertNotIn("comparison_cards", asked.guidance)

    def test_replacing_a_visual_moves_the_state_to_the_new_one(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "Planned in advance"', Signals(probe=False))
        replaced = conductor.turn("Meetings, mostly.", ENGAGED)
        self.assertEqual(replaced.display["id"], "demo-chart")
        self.assertEqual(conductor.visual_state()["key"], "day_split")
        self.assertTrue(conductor.pending_visual())
        after = conductor.turn("Hm, what is this?", Signals(intent="visuals"))
        self.assertIn("a simple chart", after.guidance)
        self.assertNotIn("how your week runs", after.guidance)

    def test_clearing_a_visual_empties_the_state_for_the_screen_too(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        skipped = conductor.turn("I'd rather not pick one.", Signals(intent="skip"))
        self.assertTrue(skipped.clear)
        self.assertIsNone(conductor.visual_state())
        self.assertFalse(conductor.pending_visual())
        self.assertNotIn(c.ON_SCREEN_WAITING.split("{")[0], skipped.guidance)

    def test_a_confirmed_visual_is_cleared_rather_than_silently_forgotten(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        concern = conductor.turn("I'm not sure any of this is relevant.", Signals(intent="concern"))
        self.assertTrue(concern.clear)  # the screen the participant sees is emptied too
        self.assertIsNone(conductor.visual_state())

    def test_giving_up_on_a_stalled_visual_clears_the_screen(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        for _ in range(2):
            self.assertIsNone(conductor.turn("More about my week.", Signals(probe=True)).display)
        moved = conductor.turn("And still more about my week.", Signals(probe=True))
        self.assertEqual(moved.action, "move to the next objective")
        self.assertTrue(moved.clear)
        self.assertIsNone(conductor.visual_state())


class VisualInteractionTests(unittest.TestCase):
    """Qalvi may only describe controls the visual on screen actually has."""

    def context_for(self, key):
        conductor, _ = make()
        step = next(step for step in conductor.steps if step.key == key)
        conductor.remaining.remove(step)
        conductor.on_screen, conductor.answered = step, False
        return conductor.turn("Sorry, what is this?", Signals(intent="visuals")).guidance

    def test_a_display_only_chart_is_never_described_as_something_to_move(self):
        guidance = self.context_for("day_split")
        self.assertIn("It has no controls at all: nothing to move, tap, or confirm", guidance)
        self.assertIn("they answer in words", guidance)
        # No instruction to operate a control that this visual does not have.
        for instruction in ("move the slider", "choose the one card", "pick every choice",
                            "then confirm it.", "then confirm."):
            self.assertNotIn(instruction, guidance, instruction)

    def test_each_visual_states_its_own_interaction(self):
        cards = self.context_for("week_shape")
        self.assertIn("choose the one card that fits best, then confirm it.", cards)
        self.assertNotIn("move the slider", cards)
        slider = self.context_for("interruptions")
        self.assertIn("move the slider to the value they mean, then confirm it.", slider)
        self.assertNotIn("card", slider)
        choices = self.context_for("causes")
        self.assertIn("pick every choice that applies, one or several, then confirm.", choices)
        self.assertNotIn("slider", choices)

    def test_every_visual_in_the_plan_declares_what_it_supports(self):
        conductor, _ = make()
        for step in conductor.steps:
            conductor.on_screen, conductor.answered = step, False
            state = conductor.visual_state()
            self.assertIn(state["action"], VISUAL_ACTION.values(), step.key)
            self.assertEqual(state["action"], VISUAL_ACTION[step.display["type"]], step.key)

    def test_the_guard_against_invented_controls_reaches_every_reply(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        later = conductor.turn("Right, okay.", ENGAGED)
        self.assertIn("never ask them to move, tap, or confirm anything it does not have", later.guidance)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        answered = conductor.turn("Mm, go on.", Signals(intent="detour"))
        self.assertIn("never describe controls it does not have", answered.guidance)


class OneReplyPerTurnTests(unittest.TestCase):
    def test_a_participant_deciding_about_a_visual_is_not_treated_as_absent(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        self.assertTrue(conductor.pending_visual())
        # This is the guard that stopped one turn producing three near-identical questions.
        self.assertFalse(check_in_allowed(user_away=True, agent_listening=True, visual_pending=True))
        conductor.turn(f'{RESPONSE_PREFIX} Chose "A mix of both"', Signals(probe=False))
        self.assertFalse(conductor.pending_visual())
        self.assertTrue(check_in_allowed(user_away=True, agent_listening=True,
                                         visual_pending=conductor.pending_visual()))

    def test_qalvi_stays_quiet_unless_it_is_genuinely_idle_and_alone(self):
        self.assertFalse(check_in_allowed(user_away=False, agent_listening=True, visual_pending=False))
        self.assertFalse(check_in_allowed(user_away=True, agent_listening=False, visual_pending=False))
        self.assertTrue(check_in_allowed(user_away=True, agent_listening=True, visual_pending=False))

    def test_one_participant_turn_produces_exactly_one_decision(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        decision = conductor.turn(f"{RESPONSE_PREFIX} Set 40%", Signals(probe=False))
        self.assertEqual(decision.guidance.count("Action for this reply:"), 1)
        self.assertIsNone(decision.display)


class CopyStyleTests(unittest.TestCase):
    def test_no_em_dashes_reach_the_interviewer_prompt(self):
        import pathlib

        import visuals
        for module in (c, visuals):
            for name, value in vars(module).items():
                if name.isupper() and isinstance(value, str):
                    self.assertNotIn("—", value, name)
                if name.isupper() and isinstance(value, dict):
                    self.assertNotIn("—", "".join(map(str, value.values())), name)
        # main.py holds the standing instructions, which import livekit and cannot be loaded here.
        self.assertNotIn("—", pathlib.Path(__file__).with_name("main.py").read_text(encoding="utf-8"))


class AmbiguityTests(unittest.TestCase):
    def test_ambiguous_wording_creates_no_evidence_and_no_visual(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn(f'{RESPONSE_PREFIX} Chose "Shaped as it goes"', Signals(probe=False))
        murky = conductor.turn("is it okay jottin it down", Signals(
            intent="continue", engagement="engaged", covered=("day_split",),
            partial=("causes",), probe=True, ambiguous=True))
        self.assertEqual(murky.action, "clarify")
        self.assertIn(c.AMBIGUOUS, murky.guidance)
        self.assertIsNone(murky.display)
        self.assertNotIn(c.PROBE_YES, murky.guidance)
        self.assertEqual(conductor.learned, ["week_shape"])
        self.assertEqual(conductor.partly, [])
        self.assertIn("day_split", [step.key for step in conductor.remaining])
        self.assertIn("Current objective: How their own working day divides", murky.guidance)

    def test_the_interview_carries_on_normally_once_they_are_clear(self):
        conductor, _ = make()
        conductor.turn("Hi.", ENGAGED)
        conductor.turn("mm sort of yeah", Signals(intent="continue", probe=True, ambiguous=True))
        clear = conductor.turn("Sorry, I meant my week is planned but it rarely survives Monday.",
                               Signals(covered=("week_shape",), probe=False))
        self.assertEqual(conductor.learned, ["week_shape"])
        self.assertNotIn(c.AMBIGUOUS, clear.guidance)
        self.assertEqual(clear.display["id"], "demo-chart")


if __name__ == "__main__":
    unittest.main()

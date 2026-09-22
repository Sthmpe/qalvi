import unittest

from clock import InterviewClock, TimeBudget
from presence import CHECK_IN, OFFER_OPTIONS, inactivity_prompt, next_check_at
from signals import Signals


class Ticker:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class ClockTests(unittest.TestCase):
    def test_no_budget_means_no_phase_and_no_description(self):
        clock = InterviewClock(None, now=Ticker())
        clock.start()
        self.assertIsNone(clock.remaining())
        self.assertEqual(clock.phase(), "none")
        self.assertIsNone(clock.describe())

    def test_absence_counts_up_to_the_grace_period_then_is_excluded(self):
        tick = Ticker()
        clock = InterviewClock(TimeBudget(max_duration=600), now=tick)
        clock.start()
        tick.t = 100
        clock.absence_started(idle_since=100)   # silence begins at 100
        tick.t = 150
        self.assertEqual(clock.active_elapsed(), 150)  # 50 s of silence still counts
        tick.t = 400                                   # 300 s silent: 90 count, 210 excluded
        clock.end_exclusion("absence")
        self.assertEqual(clock.active_elapsed(), 190)
        self.assertEqual(clock.wall_elapsed(), 400)

    def test_disconnection_and_failure_are_fully_excluded_and_reasons_do_not_cross(self):
        tick = Ticker()
        clock = InterviewClock(TimeBudget(max_duration=600), now=tick)
        clock.start()
        tick.t = 60
        clock.begin_exclusion("disconnected")
        tick.t = 120
        clock.end_exclusion("failure")       # wrong reason: still excluded
        self.assertEqual(clock.active_elapsed(), 60)
        clock.end_exclusion("disconnected")
        tick.t = 180
        self.assertEqual(clock.active_elapsed(), 120)
        clock.begin_exclusion("failure")
        tick.t = 200
        clock.end_exclusion()                # participant activity ends any exclusion
        self.assertEqual(clock.active_elapsed(), 120)

    def test_phase_thresholds_and_descriptions(self):
        tick = Ticker()
        clock = InterviewClock(TimeBudget(max_duration=600), now=tick)
        clock.start()
        self.assertEqual(clock.phase(), "open")
        self.assertEqual(clock.describe(), "About 10 minutes of the planned 10 minutes remain.")
        tick.t = 420
        self.assertEqual(clock.phase(), "focus")
        tick.t = 540
        self.assertEqual(clock.phase(), "closing")
        self.assertEqual(clock.describe(), "About 1 minute of the planned 10 minutes remain.")
        tick.t = 570
        self.assertEqual(clock.describe(), "Less than a minute of the planned 10 minutes remains.")
        tick.t = 601
        self.assertEqual(clock.phase(), "over")
        self.assertEqual(clock.describe(), "The planned 10 minutes is up.")

    def test_closing_window_is_at_least_sixty_seconds_for_short_budgets(self):
        tick = Ticker()
        clock = InterviewClock(TimeBudget(max_duration=180), now=tick)
        clock.start()
        tick.t = 125  # 55 s left is inside the 60 s minimum, even though 10% would be 18 s
        self.assertEqual(clock.phase(), "closing")


class PresenceTests(unittest.TestCase):
    def test_check_in_then_offer_then_silence(self):
        self.assertIsNone(inactivity_prompt(45, 0, mic_live=True))
        self.assertEqual(inactivity_prompt(60, 0, mic_live=True), CHECK_IN)
        self.assertIsNone(inactivity_prompt(90, 1, mic_live=True))
        self.assertEqual(inactivity_prompt(120, 1, mic_live=True), OFFER_OPTIONS)
        self.assertIsNone(inactivity_prompt(600, 2, mic_live=True))

    def test_text_mode_waits_twice_as_long_because_typing_is_invisible(self):
        self.assertIsNone(inactivity_prompt(90, 0, mic_live=False))
        self.assertEqual(inactivity_prompt(120, 0, mic_live=False), CHECK_IN)
        self.assertEqual(next_check_at(0, mic_live=False), 120)
        self.assertEqual(next_check_at(1, mic_live=True), 120)
        self.assertIsNone(next_check_at(2, mic_live=True))


class SignalParsingTests(unittest.TestCase):
    def test_parses_json_inside_prose_and_filters_unknown_values(self):
        text = 'Sure. {"intent": "fatigue", "engagement": "low", "covered": ["week_shape", "bogus"], "probe": false} done'
        signals = Signals.parse(text, ("week_shape", "causes"))
        self.assertEqual(signals, Signals(intent="fatigue", engagement="low", covered=("week_shape",), probe=False))

    def test_garbage_or_unknown_fields_degrade_to_neutral(self):
        self.assertEqual(Signals.parse("not json"), Signals())
        self.assertEqual(Signals.parse('{"intent": "attack", "engagement": 3, "covered": "x", "probe": "yes"}'), Signals())
        self.assertEqual(Signals.parse("[1, 2]"), Signals())

    def test_coverage_strength_is_kept_separate_and_never_double_counted(self):
        text = '{"intent": "continue", "covered": ["week_shape"], "partial": ["week_shape", "causes", "bogus"]}'
        signals = Signals.parse(text, ("week_shape", "causes"))
        self.assertEqual(signals.covered, ("week_shape",))
        self.assertEqual(signals.partial, ("causes",))
        self.assertFalse(signals.ambiguous)

    def test_ambiguous_wording_is_read_as_a_flag_not_a_guess(self):
        signals = Signals.parse('{"intent": "question", "ambiguous": true}', ("week_shape",))
        self.assertTrue(signals.ambiguous)
        self.assertEqual((signals.covered, signals.partial), ((), ()))
        self.assertFalse(Signals.parse('{"ambiguous": "maybe"}').ambiguous)

    def test_asking_about_the_screen_is_a_known_intent(self):
        self.assertEqual(Signals.parse('{"intent": "visuals"}').intent, "visuals")


if __name__ == "__main__":
    unittest.main()

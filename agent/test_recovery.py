import unittest

from clock import InterviewClock
from conductor import Conductor
from recovery import RecoveryError, control_data, replay_conductor, state_hash
from signals import Signals


class RecoveryTests(unittest.TestCase):
    def test_replay_uses_durable_signals_and_matches_original_progression(self):
        original = Conductor([], InterviewClock())
        messages = []
        controls = []
        for sequence, (text, signals) in enumerate([
            ("We ask customers directly.", Signals(intent="continue", engagement="engaged")),
            ("I may want to stop soon.", Signals(intent="fatigue", engagement="low")),
        ]):
            decision = original.turn(text, signals)
            message_id = f"message-{sequence}"
            messages.append({"id": message_id, "sequence": sequence, "speaker": "participant",
                             "channel": "voice", "content": text, "control_protocol_version": 1})
            controls.append({"message_id": message_id, **control_data(original, signals, decision)})
        rebuilt = replay_conductor(messages, controls)
        self.assertEqual(state_hash(rebuilt), state_hash(original))
        self.assertEqual(rebuilt.turns, 2)

    def test_missing_legacy_and_conflicting_records_fail_closed(self):
        signals = Signals()
        original = Conductor([], InterviewClock())
        decision = original.turn("A reply", signals)
        message = {"id": "message-1", "sequence": 0, "speaker": "participant",
                   "content": "A reply", "control_protocol_version": 1}
        control = {"message_id": "message-1", **control_data(original, signals, decision)}
        with self.assertRaises(RecoveryError):
            replay_conductor([message], [])
        with self.assertRaises(RecoveryError):
            replay_conductor([{**message, "control_protocol_version": None}], [control])
        with self.assertRaises(RecoveryError):
            replay_conductor([message], [{**control, "decision_action": "stop"}])
        with self.assertRaises(RecoveryError):
            replay_conductor([message, message], [control])


if __name__ == "__main__":
    unittest.main()

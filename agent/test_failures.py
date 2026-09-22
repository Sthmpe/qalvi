import unittest
from types import SimpleNamespace

from failures import (
    LLM, SIGNALING, STT, TTS, TTS_RATE_LIMIT, UNKNOWN,
    chat_item, classify, from_error_event, signaling_failure,
)


def error_event(error_type, recoverable, status_code=None):
    """Shaped like a LiveKit ErrorEvent: event.error is the TTSError, whose .error is the APIError."""
    return SimpleNamespace(
        type="error",
        error=SimpleNamespace(
            type=error_type,
            recoverable=recoverable,
            error=SimpleNamespace(status_code=status_code, message="Too Many Requests"),
        ),
    )


class ClassificationTests(unittest.TestCase):
    def test_tts_429_is_a_rate_limit_that_ends_voice_only(self):
        failure = from_error_event(error_event("tts_error", recoverable=False, status_code=429))
        self.assertEqual(failure.kind, TTS_RATE_LIMIT)
        self.assertEqual(failure.status_code, 429)
        self.assertTrue(failure.voice_only)
        self.assertTrue(failure.ends_voice)
        self.assertFalse(failure.stops_interview)

    def test_a_tts_failure_is_never_a_signaling_failure(self):
        failure = from_error_event(error_event("tts_error", recoverable=False, status_code=429))
        self.assertNotEqual(failure.kind, SIGNALING)
        self.assertNotEqual(signaling_failure().kind, failure.kind)
        self.assertFalse(signaling_failure().voice_only)
        self.assertFalse(signaling_failure().ends_voice)

    def test_retryable_tts_errors_do_not_end_voice(self):
        failure = from_error_event(error_event("tts_error", recoverable=True, status_code=429))
        self.assertEqual(failure.kind, TTS_RATE_LIMIT)
        self.assertTrue(failure.voice_only)
        self.assertFalse(failure.ends_voice)

    def test_other_tts_failures_end_voice_without_being_called_a_rate_limit(self):
        failure = from_error_event(error_event("tts_error", recoverable=False, status_code=503))
        self.assertEqual(failure.kind, TTS)
        self.assertTrue(failure.ends_voice)

    def test_stt_and_llm_failures_are_distinct_and_never_disable_voice(self):
        for error_type, kind in (("stt_error", STT), ("llm_error", LLM)):
            failure = from_error_event(error_event(error_type, recoverable=False))
            self.assertEqual(failure.kind, kind)
            self.assertFalse(failure.voice_only)
            self.assertFalse(failure.ends_voice)
            self.assertTrue(failure.stops_interview)

    def test_unknown_and_malformed_events_stay_neutral(self):
        self.assertEqual(from_error_event(SimpleNamespace()).kind, UNKNOWN)
        self.assertEqual(from_error_event(error_event("mystery", recoverable=False)).kind, UNKNOWN)
        self.assertFalse(from_error_event(SimpleNamespace()).ends_voice)
        self.assertEqual(classify(None, recoverable=False).kind, UNKNOWN)


class ConversationItemTests(unittest.TestCase):
    def test_agent_handoff_items_are_ignored_instead_of_read_as_chat(self):
        handoff = SimpleNamespace(type="agent_handoff", old_agent_id=None, new_agent_id="agent-2")
        self.assertIsNone(chat_item(handoff))
        for item in (
            SimpleNamespace(type="function_call", name="lookup"),
            SimpleNamespace(type="function_call_output", output="{}"),
            SimpleNamespace(type="agent_config_update"),
        ):
            self.assertIsNone(chat_item(item))

    def test_ordinary_chat_items_still_yield_role_and_text(self):
        assistant = SimpleNamespace(type="message", role="assistant", text_content="Tell me more.")
        self.assertEqual(chat_item(assistant), ("assistant", "Tell me more."))
        user = SimpleNamespace(type="message", role="user", text_content=None)
        self.assertEqual(chat_item(user), ("user", ""))

    def test_a_message_without_a_usable_role_is_ignored(self):
        self.assertIsNone(chat_item(SimpleNamespace(type="message", role=None, text_content="x")))


if __name__ == "__main__":
    unittest.main()

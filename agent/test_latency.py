import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from latency import install_latency_logging


class Emitter:
    def __init__(self):
        self.handlers = {}

    def on(self, name, callback=None):
        def register(fn):
            self.handlers[name] = fn
            return fn
        return register(callback) if callback else register


class LatencyTests(unittest.TestCase):
    def install(self):
        self.session = Emitter()
        self.stt, self.llm, self.tts = Emitter(), Emitter(), Emitter()
        install_latency_logging(self.session, room_name="test-room",
                                stt=self.stt, llm=self.llm, tts=self.tts)

    @patch.dict("os.environ", {}, clear=True)
    @patch("sys.argv", ["main.py", "start"])
    def test_disabled_in_production(self):
        self.install()
        self.assertEqual(self.session.handlers, {})
        self.assertEqual(self.llm.handlers, {})

    @patch.dict("os.environ", {}, clear=True)
    @patch("sys.argv", ["main.py", "dev"])
    def test_metrics_are_ms_and_do_not_log_transcripts(self):
        with self.assertLogs("qalvi.latency", level="INFO") as captured:
            self.install()
            self.session.handlers["user_input_transcribed"](SimpleNamespace(
                is_final=True, item_id="input-1", created_at=10.5, transcript="PRIVATE TEXT"))
            self.llm.handlers["metrics_collected"](SimpleNamespace(
                type="llm_metrics", request_id="request-1", speech_id="speech-1", duration=1.2, ttft=0.25))
            self.session.handlers["conversation_item_added"](SimpleNamespace(item=SimpleNamespace(
                id="reply-1", role="assistant", metrics={"tts_node_ttfb": 0.4, "e2e_latency": 1.8})))
        logs = [json.loads(record.getMessage().split("[qalvi latency] ")[1]) for record in captured.records]
        self.assertEqual(logs[1]["received_at_ms"], 10500)
        self.assertEqual(logs[2]["ttft_ms"], 250)
        self.assertEqual(logs[3]["tts_node_ttfb_ms"], 400)
        self.assertNotIn("PRIVATE TEXT", str(logs))


if __name__ == "__main__":
    unittest.main()

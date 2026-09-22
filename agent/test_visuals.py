import json
import unittest

from visuals import DEMO_STEPS, demo_steps_for_room

# Mirrors the structural rules enforced by the browser's parseDisplayAction.
REQUIRED = {
    "comparison_cards": {"options"},
    "bar_chart": {"bars"},
    "slider": {"min", "max", "step", "initial"},
    "multiple_choice": {"options"},
}


class VisualStepTests(unittest.TestCase):
    def test_demo_steps_are_not_enabled_for_real_study_rooms(self):
        self.assertEqual(len(demo_steps_for_room("qalvi-demo-test")), len(DEMO_STEPS))
        for room in ("", "study-123", "qalvi-study-123"):
            self.assertEqual(demo_steps_for_room(room), [])

    def test_demo_steps_are_well_formed_and_json_serialisable(self):
        seen_ids, seen_keys = set(), set()
        for step in DEMO_STEPS:
            display = json.loads(json.dumps(step.display))
            self.assertIn(display["type"], REQUIRED)
            self.assertTrue(display["id"] and display["prompt"])
            self.assertNotIn(display["id"], seen_ids)
            self.assertNotIn(step.key, seen_keys)
            seen_ids.add(display["id"])
            seen_keys.add(step.key)
            self.assertTrue(REQUIRED[display["type"]] <= display.keys())
            for option in display.get("options", []):
                self.assertTrue(option["id"] and option["label"])
                if display["type"] == "comparison_cards":
                    self.assertTrue(option["description"])
            for bar in display.get("bars", []):
                self.assertGreaterEqual(bar["value"], 0)
            if display["type"] == "slider":
                self.assertLess(display["min"], display["max"])
                self.assertGreater(display["step"], 0)
                self.assertTrue(display["min"] <= display["initial"] <= display["max"])
            self.assertIn(step.priority, ("high", "low"))
            self.assertTrue(step.topic and step.purpose and step.guidance)
            self.assertNotIn("—", step.guidance + step.purpose + step.topic + display["prompt"])

    def test_at_least_one_high_priority_step_survives_shortening(self):
        self.assertTrue(any(step.priority == "high" for step in DEMO_STEPS))


if __name__ == "__main__":
    unittest.main()

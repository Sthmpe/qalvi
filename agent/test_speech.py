import unittest

from speech import SpeechFilter, clean


class CleanTests(unittest.TestCase):
    def test_the_leak_seen_in_the_live_transcript_is_removed(self):
        leaked = "&#x20;\n\n[On screen] A list of possible causes is now on screen.\n\n**Confirm selection**"
        cleaned = clean(leaked)
        for fragment in ("&#x20;", "[On screen]", "**"):
            self.assertNotIn(fragment, cleaned)
        self.assertIn("A list of possible causes is now on screen.", cleaned)
        self.assertIn("Confirm selection", cleaned)

    def test_markdown_emphasis_and_structure_never_reach_speech(self):
        self.assertEqual(clean("Tap **Confirm** or *skip* it."), "Tap Confirm or skip it.")
        self.assertEqual(clean("## Your week\n- one\n- two"), "Your week\none\ntwo")
        self.assertEqual(clean("Use the `slider` now."), "Use the slider now.")
        self.assertEqual(clean("Read _this_ part."), "Read this part.")
        self.assertEqual(clean("See [the chart](https://example.com) there."), "See the chart there.")

    def test_html_entities_are_decoded_rather_than_spoken(self):
        self.assertEqual(clean("Meetings &amp; messages&#x20;matter."), "Meetings & messages matter.")
        self.assertEqual(clean("a b"), "a b")

    def test_no_whitespace_entity_survives_in_any_common_form(self):
        # Seen live while the options on the cards were being explained.
        spelled = clean("Planned in advance,&#x20;Shaped as it goes")
        self.assertNotIn("&", spelled)
        self.assertEqual(spelled, "Planned in advance, Shaped as it goes")
        for entity in ("&#x20;", "&#X20;", "&#32;", "&#032;", "&nbsp;", "&NBSP;", "&#xa0;", "&#160;",
                       "&ensp;", "&emsp;", "&thinsp;", "&#x20", "&nbsp", "&amp;#x20;", "&amp;nbsp;"):
            cleaned = clean(f"one{entity}two")
            self.assertNotIn("&", cleaned, entity)
            self.assertNotIn("#", cleaned, entity)
            self.assertEqual(cleaned, "one two", entity)

    def test_a_plain_ampersand_is_still_an_ampersand(self):
        self.assertEqual(clean("focus & meetings"), "focus & meetings")
        self.assertEqual(clean("focus &amp; meetings"), "focus & meetings")

    def test_ordinary_speech_is_left_alone(self):
        for line in (
            "How much of a typical day gets interrupted?",
            "That makes sense. What usually causes the shift?",
            "Thanks, that is really helpful.",
        ):
            self.assertEqual(clean(line), line)

    def test_a_word_with_an_underscore_inside_it_survives(self):
        self.assertEqual(clean("week_shape"), "week_shape")


class StreamingTests(unittest.TestCase):
    def collect(self, deltas):
        speech = SpeechFilter()
        return "".join([speech.push(delta) for delta in deltas] + [speech.flush()])

    def test_markers_split_across_chunks_are_still_removed(self):
        self.assertEqual(self.collect(["Tap **Conf", "irm sel", "ection** now."]),
                         "Tap Confirm selection now.")
        self.assertEqual(self.collect(["Spaced&#", "x20;out ", "words."]), "Spaced out words.")

    def test_nothing_is_lost_or_duplicated_across_a_stream(self):
        chunks = ["How ", "much of ", "a typical day ", "gets interrupted?"]
        self.assertEqual(self.collect(chunks), "How much of a typical day gets interrupted?")

    def test_a_single_chunk_with_no_whitespace_is_held_until_flush(self):
        speech = SpeechFilter()
        self.assertEqual(speech.push("Right"), "")
        self.assertEqual(speech.flush(), "Right")


if __name__ == "__main__":
    unittest.main()

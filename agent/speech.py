"""Keep the interviewer's replies in plain spoken language.

The reply model is told to speak plainly, but a stray asterisk, a repeated internal
marker, or an HTML entity would otherwise be read aloud by the voice and land in the
participant's transcript. This is the last check before either happens.

Presentation syntax only. Nothing here rewrites what Qalvi said.
"""

from __future__ import annotations

import html
import re

LINK = re.compile(r"\[([^\]\n]*)\]\([^)\n]*\)")            # keep the words, drop the target
MARKER = re.compile(r"^[ \t]*\[[^\]\n]{1,40}\][ \t]*", re.MULTILINE)  # internal markers, e.g. [On screen]
HEADING = re.compile(r"^[ \t]*#{1,6}[ \t]+", re.MULTILINE)
BULLET = re.compile(r"^[ \t]*(?:[-*+]|\d+\.)[ \t]+", re.MULTILINE)
# Emphasis and code marks. Underscores survive inside a word, so snake_case is left alone.
EMPHASIS = re.compile(r"\*+|`+|~~|(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])")
SPACES = re.compile(r"[ \t]{2,}")
# The handful of HTML entities that stand for a space. Named explicitly, because a
# participant must never read one, and an escaped or half-written one still counts.
WHITESPACE_ENTITY = re.compile(
    r"&(?:amp;)*(?:nbsp|ensp|emsp|thinsp|#0*(?:160|32|13|10|9)|#[xX]0*(?:a0|20|9|a|d));?",
    re.IGNORECASE,
)


def _spaces_for_entities(text: str) -> str:
    """Turn whitespace entities into real spaces, including once-escaped ones."""
    for _ in range(2):  # an escaped entity decodes into another entity
        replaced = html.unescape(WHITESPACE_ENTITY.sub(" ", text))
        if replaced == text:
            break
        text = replaced
    return text


def clean(text: str) -> str:
    """Strip presentation syntax that should never be spoken or shown to a participant."""
    text = _spaces_for_entities(text).replace(" ", " ")
    text = LINK.sub(r"\1", text)
    text = HEADING.sub("", text)
    text = BULLET.sub("", text)
    text = MARKER.sub("", text)
    text = EMPHASIS.sub("", text)
    return SPACES.sub(" ", text)


class SpeechFilter:
    """Cleans a reply as it streams, holding back only the last partial word.

    Markers never contain a space, so cleaning at whitespace boundaries keeps one
    whole and still lets speech synthesis start on the first few words.
    """

    def __init__(self) -> None:
        self._held = ""

    def push(self, delta: str) -> str:
        self._held += delta
        cut = max(self._held.rfind(" "), self._held.rfind("\n"), self._held.rfind("\t"))
        if cut < 0:
            return ""
        ready, self._held = self._held[: cut + 1], self._held[cut + 1:]
        return clean(ready)

    def flush(self) -> str:
        ready, self._held = self._held, ""
        return clean(ready)

"""Per-turn participant signals, reasoned by the model from the conversation.

The classifier returns a small structured reading of the latest participant turn.
It never decides what happens next; the conductor does. Any failure or timeout
degrades to neutral signals so the interview simply continues.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass

INTENTS = ("continue", "concern", "fatigue", "time_left", "stop", "skip", "detour", "question",
           "unclear", "resume", "visuals")
ENGAGEMENT = ("engaged", "neutral", "low")


def _keys(value, known_topics: tuple[str, ...]) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(dict.fromkeys(key for key in value if key in known_topics))


@dataclass(frozen=True)
class Signals:
    intent: str = "continue"
    engagement: str = "neutral"
    covered: tuple[str, ...] = ()   # answered in enough substance to retire the topic
    partial: tuple[str, ...] = ()   # touched in words, not yet resolved
    probe: bool | None = None       # None means the reply model should judge for itself
    ambiguous: bool = False         # wording that must not be read as a specific answer

    @classmethod
    def parse(cls, text: str, known_topics: tuple[str, ...] = ()) -> "Signals":
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return cls()
        try:
            data = json.loads(match.group(0))
        except ValueError:
            return cls()
        if not isinstance(data, dict):
            return cls()
        intent = data.get("intent")
        engagement = data.get("engagement")
        probe = data.get("probe")
        covered = _keys(data.get("covered"), known_topics)
        return cls(
            intent=intent if intent in INTENTS else "continue",
            engagement=engagement if engagement in ENGAGEMENT else "neutral",
            covered=covered,
            # A topic cannot be both settled and only touched; the stronger reading wins.
            partial=tuple(key for key in _keys(data.get("partial"), known_topics) if key not in covered),
            probe=probe if isinstance(probe, bool) else None,
            ambiguous=data.get("ambiguous") is True,
        )


@dataclass
class Topic:
    key: str
    description: str


@dataclass
class Exchange:
    role: str  # "participant" or "qalvi"
    text: str


PROMPT = """You read one turn of a research conversation and return JSON only.

Classify the participant's latest message in context.

intent, one of:
- continue: answering or elaborating on the research topic
- detour: a joke, side comment, or unrelated tangent that does not advance the research
- question: asks the interviewer something (an opinion, a fact, what the interviewer thinks)
- concern: questions the relevance or purpose, finds a question or visual confusing, or says they already answered
- fatigue: tired, finds it long, wants to finish soon, but is not clearly stopping
- time_left: asks how much time or how many questions remain
- stop: clearly wants to end the conversation now
- resume: corrects a misunderstanding that they wanted to stop; they want to keep going
- skip: declines a specific question or on-screen visual but is willing to continue
- visuals: asks about, asks for, or comments on anything on screen. This includes asking what the thing already shown is for, what to do with it, or why it is there, and asking why nothing has been shown
- unclear: the message is probably garbled, fragmentary, or unintelligible speech recognition output

engagement, one of: engaged (detailed, thoughtful), neutral, low (very short, flat, or disengaged)

covered: keys of planned topics the participant has now answered fully enough that asking again, in any form, would add nothing. Empty if none, and always empty when intent is unclear.

partial: keys of planned topics they have touched in words but left vague, approximate, or one-sided. A topic belongs here, not in covered, whenever a more precise number, a comparison, a tradeoff, or a concrete choice would still add something. Never list the same key in both.

probe: true if one short follow-up would add something useful to what they just said, false if the answer is already sufficient or a follow-up would feel repetitive.

ambiguous: true if their wording is hard to interpret confidently, so that any specific answer would be a guess. When true, covered and partial must both be empty. Judge only what they actually said, never what they probably meant.

Return exactly: {"intent": "...", "engagement": "...", "covered": [...], "partial": [...], "probe": true|false, "ambiguous": true|false}"""


def classifier_input(recent: list[Exchange], latest: str, topics: list[Topic], on_screen: str | None) -> str:
    lines = ["Planned topics:"]
    lines += [f"- {topic.key}: {topic.description}" for topic in topics] or ["- (none remaining)"]
    lines.append(f"On screen now: {on_screen or 'nothing'}")
    lines.append("Recent conversation:")
    lines += [f"{exchange.role}: {exchange.text}" for exchange in recent[-8:]]
    lines.append(f"Latest participant message: {latest}")
    return "\n".join(lines)


async def classify(model, recent: list[Exchange], latest: str, topics: list[Topic],
                   on_screen: str | None, timeout: float = 2.0) -> Signals:
    """Ask the model for signals; fall back to neutral on any error or timeout."""
    from livekit.agents import llm

    chat_ctx = llm.ChatContext.empty()
    chat_ctx.add_message(role="system", content=PROMPT)
    chat_ctx.add_message(role="user", content=classifier_input(recent, latest, topics, on_screen))

    async def run() -> str:
        text = ""
        async with model.chat(chat_ctx=chat_ctx) as stream:
            async for chunk in stream:
                if chunk.delta and chunk.delta.content:
                    text += chunk.delta.content
        return text

    try:
        return Signals.parse(await asyncio.wait_for(run(), timeout), tuple(topic.key for topic in topics))
    except Exception:
        return Signals()

"""Conservative inactivity handling: at most two gentle check-ins, never an interruption.

Idle time is measured from the framework's mutual-idle signal (agent listening,
participant silent). The caller only speaks when the agent is still listening and
the participant is still silent at that moment.
"""

from __future__ import annotations

CHECK_IN = (
    "The participant has been quiet for a while. Gently check, in one short sentence, "
    "whether they are still there or need a moment. Do not repeat the question."
)
OFFER_OPTIONS = (
    "The participant is still quiet. In one or two short sentences, say it is fine to "
    "take their time, and offer to continue, skip the current question, or finish here."
)


def check_in_allowed(user_away: bool, agent_listening: bool, visual_pending: bool) -> bool:
    """Whether Qalvi may speak unprompted right now.

    A participant reading something on screen and deciding is taking part in the
    interview, not absent. Speaking then repeats the question they are answering.
    """
    return user_away and agent_listening and not visual_pending


def inactivity_prompt(idle_seconds: float, nudges_sent: int, mic_live: bool) -> str | None:
    """Return what to say after genuine inactivity, or None to stay silent.

    Typing is invisible to the agent, so a muted microphone (text mode) doubles the wait.
    """
    first = 60.0 if mic_live else 120.0
    if nudges_sent == 0 and idle_seconds >= first:
        return CHECK_IN
    if nudges_sent == 1 and idle_seconds >= first + 60.0:
        return OFFER_OPTIONS
    return None


def next_check_at(nudges_sent: int, mic_live: bool) -> float | None:
    """Idle seconds at which the next check-in becomes due, or None when no more are allowed."""
    first = 60.0 if mic_live else 120.0
    return {0: first, 1: first + 60.0}.get(nudges_sent)

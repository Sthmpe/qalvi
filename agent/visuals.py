"""Predefined on-screen visuals for the demo conversation.

Each step is a tool the interviewer may use, not a mandatory stop. The conductor
decides whether a step is shown, skipped, or dropped, based on the participant.
The LLM only receives a short note about what is on screen; it never authors
display actions.
"""

from __future__ import annotations

from dataclasses import dataclass

DISPLAY_TOPIC = "qalvi.display"
RESPONSE_PREFIX = "[On screen]"

# What each predefined visual is actually good for. Used when a topic has been
# touched in words but not settled, and when the participant asks what can be shown.
VISUAL_VALUE = {
    "comparison_cards": "let them weigh a few alternatives and show which one really fits",
    "bar_chart": "turn a vague sense of proportion into something concrete",
    "slider": "put a rough number on something they described loosely",
    "multiple_choice": "show which options actually apply, with less effort than describing them",
}
VISUAL_NAME = {
    "comparison_cards": "a short comparison to choose between",
    "bar_chart": "a simple chart",
    "slider": "a slider",
    "multiple_choice": "a list of choices",
}
# What the participant can actually do with each one. A chart is there to be read,
# so Qalvi must never invite anyone to move, tap, or confirm something that is not there.
VISUAL_ACTION = {
    "comparison_cards": "choose the one card that fits best, then confirm it.",
    "bar_chart": (
        "read it and compare it with their own experience. It has no controls at all: "
        "nothing to move, tap, or confirm, so they answer in words."
    ),
    "slider": "move the slider to the value they mean, then confirm it.",
    "multiple_choice": "pick every choice that applies, one or several, then confirm.",
}

DEMO_GOAL = (
    "how the participant currently manages competing priorities in a working week, "
    "and what gets in the way"
)


@dataclass(frozen=True)
class Step:
    key: str          # planned topic key, used to recognise when it is already covered
    topic: str        # one-line description of what we want to learn
    purpose: str      # why we ask, in case the participant questions it
    priority: str     # "high" steps survive shortening; "low" steps are dropped first
    display: dict
    guidance: str     # how to introduce the visual, for the reply model


DEMO_STEPS: list[Step] = [
    Step(
        key="week_shape",
        topic="How structured or reactive their working week usually is",
        purpose="to understand how much of their week is planned versus shaped by what comes in",
        priority="high",
        display={
            "type": "comparison_cards",
            "id": "demo-cards",
            "prompt": "Which of these feels closest to how your week runs?",
            "options": [
                {"id": "planned", "label": "Planned in advance",
                 "description": "Most of the week is mapped out before it starts."},
                {"id": "shaped", "label": "Shaped as it goes",
                 "description": "Priorities shift with whatever comes in."},
                {"id": "mixed", "label": "A mix of both",
                 "description": "A few fixed anchors, and the rest stays open."},
            ],
        },
        guidance=(
            "Three cards are now on the participant's screen: 'Planned in advance', "
            "'Shaped as it goes', and 'A mix of both'. Respond briefly to what they said, "
            "then ask them to tap the card that feels closest to how their week runs. "
            "Do not read the cards aloud."
        ),
    ),
    Step(
        key="day_split",
        topic="How their own working day divides between focus, meetings, and coordination",
        purpose="to compare their day with a simple example split",
        priority="low",
        display={
            "type": "bar_chart",
            "id": "demo-chart",
            "prompt": "One way a working day can split. How does yours compare?",
            "unit": "%",
            "bars": [
                {"id": "focus", "label": "Focused work", "value": 35},
                {"id": "meetings", "label": "Meetings", "value": 25},
                {"id": "messages", "label": "Messages and coordination", "value": 25},
                {"id": "other", "label": "Everything else", "value": 15},
            ],
        },
        guidance=(
            "A simple example chart is now on screen. It shows one way a working day can "
            "split: 35 percent focused work, 25 percent meetings, 25 percent messages and "
            "coordination, 15 percent everything else. It is an illustration, not research "
            "data. Ask, in one sentence, how their own day compares."
        ),
    ),
    Step(
        key="interruptions",
        topic="Roughly how much of a typical day gets interrupted",
        purpose="to get a rough sense of how often their plans get disrupted",
        priority="high",
        display={
            "type": "slider",
            "id": "demo-slider",
            "prompt": "Roughly how much of a typical day gets interrupted?",
            "min": 0,
            "max": 100,
            "step": 5,
            "initial": 30,
            "unit": "%",
            "minLabel": "Rarely",
            "maxLabel": "Constantly",
        },
        guidance=(
            "A slider from 0 to 100 percent is now on screen. Ask the participant to set "
            "it to roughly how much of a typical day gets interrupted, then tap 'Confirm "
            "value'. Keep it to one sentence."
        ),
    ),
    Step(
        key="causes",
        topic="What usually causes their priorities to shift",
        purpose="to learn where interruptions tend to come from",
        priority="low",
        display={
            "type": "multiple_choice",
            "id": "demo-choice",
            "prompt": "What usually causes the shift?",
            "multiple": True,
            "options": [
                {"id": "clients", "label": "Messages from clients or customers"},
                {"id": "team", "label": "Requests from the team"},
                {"id": "urgent", "label": "Something urgent breaks"},
                {"id": "self", "label": "Changing my own mind"},
            ],
        },
        guidance=(
            "A list of possible causes is now on screen, and the participant can choose "
            "more than one. Ask them to pick whatever usually causes their priorities to "
            "shift, then tap 'Confirm selection'. Do not list the options aloud."
        ),
    ),
]


def demo_steps_for_room(room_name: str) -> list[Step]:
    """Only explicitly named demo rooms get the demo plan; other rooms have no visuals."""
    return list(DEMO_STEPS) if room_name.startswith("qalvi-demo-") else []

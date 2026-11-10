"""The researcher's saved study, turned into an interview plan for the conductor.

The plan comes from the database through the fenced writer (persistence.py), never
from the browser or the room. Everything is validated again here: a malformed
visual is dropped and its objective stays a conversation-only objective, so
nothing the researcher did not write, and nothing invalid, can reach the screen.
The LLM never authors a visual; it only hears what is on screen.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass

from visuals import VISUAL_NAME, Step

OBJECTIVE_ID = re.compile(r"^[a-z0-9_]{1,40}$")
MAX_OBJECTIVES = 10
MAX_TEXT = 1200
METHODOLOGY = "study-plan-v1"


class StudyPlanError(Exception):
    """The saved study cannot drive an interview."""


@dataclass(frozen=True)
class StudyPlan:
    study_id: str
    title: str
    goal: str
    audience: str
    assumptions: tuple[str, ...]
    steps: tuple[Step, ...]
    fingerprint: str  # identifies the exact setup this interview followed, for logs


def _text(value, limit: int = MAX_TEXT) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = " ".join(value.split())
    return cleaned[:limit]


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def _options(value, require_description: bool) -> list[dict] | None:
    if not isinstance(value, list) or not 2 <= len(value) <= 6:
        return None
    options = []
    for item in value:
        if not isinstance(item, dict) or not _text(item.get("id")) or not _text(item.get("label")):
            return None
        description = item.get("description")
        if description is not None and not isinstance(description, str):
            return None
        if require_description and not _text(description):
            return None
        option = {"id": item["id"], "label": _text(item["label"], 120)}
        if _text(description):
            option["description"] = _text(description, 120)
        options.append(option)
    return options if len({option["id"] for option in options}) == len(options) else None


def validate_visual(objective_id: str, value) -> dict | None:
    """The same rules as the browser's parseDisplayAction, plus ownership by the objective."""
    if not isinstance(value, dict) or value.get("id") != f"study-{objective_id}":
        return None
    prompt = _text(value.get("prompt"), 300)
    if not prompt:
        return None
    base = {"type": value.get("type"), "id": value["id"], "prompt": prompt}
    kind = value.get("type")
    if kind in ("comparison_cards", "multiple_choice"):
        options = _options(value.get("options"), kind == "comparison_cards")
        if options is None or (kind == "comparison_cards" and len(options) > 4):
            return None
        multiple = value.get("multiple")
        if multiple is not None and not isinstance(multiple, bool):
            return None
        return {**base, "options": options, **({"multiple": True} if kind == "multiple_choice" and multiple else {})}
    if kind == "bar_chart":
        bars = value.get("bars")
        if not isinstance(bars, list) or not 2 <= len(bars) <= 8:
            return None
        parsed = []
        for bar in bars:
            amount = _number(bar.get("value")) if isinstance(bar, dict) else None
            if amount is None or amount < 0 or not _text(bar.get("id")) or not _text(bar.get("label")):
                return None
            parsed.append({"id": bar["id"], "label": _text(bar["label"], 120), "value": amount})
        if len({bar["id"] for bar in parsed}) != len(parsed):
            return None
        unit = value.get("unit")
        if unit is not None and not isinstance(unit, str):
            return None
        return {**base, "bars": parsed, **({"unit": _text(unit, 12)} if _text(unit) else {})}
    if kind == "slider":
        low, high, step, initial = (_number(value.get(key)) for key in ("min", "max", "step", "initial"))
        if None in (low, high, step, initial) or low >= high or step <= 0 or not low <= initial <= high:
            return None
        extra = {}
        for key, limit in (("unit", 12), ("minLabel", 120), ("maxLabel", 120)):
            item = value.get(key)
            if item is not None and not isinstance(item, str):
                return None
            if _text(item):
                extra[key] = _text(item, limit)
        return {**base, "min": low, "max": high, "step": step, "initial": initial, **extra}
    return None


def visual_guidance(display: dict, in_words: bool) -> str:
    """How the reply model introduces a researcher's visual. Deterministic; never a script."""
    kind = VISUAL_NAME.get(display["type"], "something")
    lead = f"{kind[0].upper()}{kind[1:]} is now on the participant's screen, asking: \"{display['prompt']}\". "
    if display["type"] == "bar_chart":
        bars = ", ".join(f"{bar['label']} {bar['value']:g}{display.get('unit', '')}" for bar in display["bars"])
        return (lead + f"It is an illustration from the researcher, not research data: {bars}. "
                "Respond briefly to what they said, then ask in one sentence how their own experience compares.")
    if in_words:
        return (lead + "They can read it but answer in their own words, by saying or typing which fits and why. "
                "Respond briefly to what they said, then invite them to look at it and tell you. "
                "Do not read every option aloud.")
    action = {"comparison_cards": "tap the card that fits best and confirm it",
              "multiple_choice": "pick whatever applies and confirm",
              "slider": "set the slider and confirm the value"}[display["type"]]
    return lead + f"Respond briefly to what they said, then ask them to {action}. Do not read the options aloud."


def build_plan(data, *, in_words: bool = True) -> StudyPlan:
    """Turn the database's study plan into conductor steps. Fails closed without a usable plan."""
    if not isinstance(data, dict):
        raise StudyPlanError("Study plan is missing")
    goal = _text(data.get("research_goal"))
    objectives = data.get("objectives")
    if not goal or not isinstance(objectives, list) or not objectives:
        raise StudyPlanError("Study plan has no goal or objectives")
    steps: list[Step] = []
    seen: set[str] = set()
    for item in objectives[:MAX_OBJECTIVES]:
        if not isinstance(item, dict):
            continue
        key, topic = item.get("id"), _text(item.get("topic"), 300)
        if not isinstance(key, str) or not OBJECTIVE_ID.fullmatch(key) or key in seen or not topic:
            continue
        seen.add(key)
        display = validate_visual(key, item.get("visual")) if item.get("visual") else None
        steps.append(Step(
            key=key,
            topic=topic,
            purpose=f"it helps the researcher understand {topic[0].lower()}{topic[1:]}",
            priority="low" if item.get("priority") == "low" else "high",
            display=display,
            guidance=visual_guidance(display, in_words) if display else "",
        ))
    if not steps:
        raise StudyPlanError("Study plan has no usable objectives")
    assumptions = tuple(text for text in (_text(value, 300) for value in data.get("assumptions") or []
                                          if isinstance(value, str)) if text)[:10]
    canonical = json.dumps({"goal": goal, "objectives": objectives, "assumptions": list(assumptions)},
                           sort_keys=True, separators=(",", ":"), default=str)
    return StudyPlan(
        study_id=str(data.get("study_id", "")),
        title=_text(data.get("title"), 200),
        goal=goal,
        audience=_text(data.get("audience"), 300),
        assumptions=assumptions,
        steps=tuple(steps),
        fingerprint=hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16],
    )


def study_context(plan: StudyPlan) -> str:
    """Standing context for the reply model. Assumptions guide listening; they are never voiced."""
    objectives = " ".join(f"{index}. {step.topic}." for index, step in enumerate(plan.steps, 1))
    context = (
        f"This is a real research interview. The research goal is to understand {plan.goal.rstrip('.')}. "
        + (f"The participant was invited as: {plan.audience.rstrip('.')}. " if plan.audience else "")
        + f"The objectives, in order of the plan, are: {objectives} "
        "Pursue them conversationally, starting with the participant's real recent experience before any "
        "hypothetical, and let each turn's note tell you which objective is current."
    )
    if plan.assumptions:
        context += (
            " The researcher holds these assumptions: " + " ".join(f"({a.rstrip('.')})" for a in plan.assumptions)
            + ". Listen for evidence that supports or contradicts them. Never state them, hint at them, "
            "or try to get the participant to agree."
        )
    return context

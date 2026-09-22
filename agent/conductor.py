"""Conversational control: follow the person conversationally, follow the research strategically.

One call per participant turn. Inputs are the participant's text, the model's
structured reading of it (signals), the research plan, and the optional time
budget. Outputs are what to put on screen (if anything), the action chosen for
this reply, and a short note for the reply model that always carries the
research anchor: goal, current objective, what is learned, what is unresolved.
No timers, no phrase rules.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from clock import InterviewClock
from signals import Signals, Topic
from visuals import RESPONSE_PREFIX, VISUAL_ACTION, VISUAL_NAME, VISUAL_VALUE, Step

STALL_TURNS = 3   # on-topic turns on one objective without progress before moving on


def _join(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f", or {names[-1]}"


@dataclass
class Decision:
    display: dict | None = None   # visual to send
    clear: bool = False           # take the current visual off the screen
    closing: bool = False         # this reply should end the interview
    action: str = ""              # the decision principle chosen for this reply
    guidance: str = ""            # note for the reply model, this turn only


# Notes for the reply model. Each is a direction, never a script.
ANSWER_RECEIVED = (
    "The participant just answered using something on screen. Acknowledge it in a few "
    "words. Never say the marker '[On screen]' aloud."
)
PROBE_YES = (
    "Their answer leaves something worth one short, specific follow-up. Ask it, and have a "
    "reason for it: to clarify behaviour, understand motivation, uncover a pain point, find "
    "an alternative, understand a tradeoff, test an assumption, or resolve an ambiguity. "
    "'Anything else?' is not a reason."
)
PROBE_NO = "Their answer is sufficient. Do not ask why. Acknowledge it and move to the current objective."
PROBE_JUDGE = (
    "Ask one short follow-up only if it has a clear research reason; otherwise acknowledge "
    "and move to the current objective."
)
DETOUR_LIGHT = (
    "They went briefly off topic. Respond naturally in a few words, do not expand on the "
    "tangent, then bridge back to the current objective with one relevant question."
)
DETOUR_FIRM = (
    "They have stayed off topic for a few turns. Acknowledge it kindly, remind them in one "
    "sentence what this conversation is trying to understand, and ask the next relevant "
    "question. Do not scold them or cut them off abruptly."
)
QUESTION = (
    "They asked you something. Answer briefly and neutrally if appropriate; never sell, "
    "advise at length, or let the question replace the interview. Then say you are more "
    "interested in their own experience and return to the current objective with one question."
)
UNCLEAR = (
    "That turn was probably unintelligible or garbled. Do not guess at what they meant and "
    "do not act on it. Ask, in one short sentence, for them to repeat it or say it another way."
)
RESUME = (
    "You misread them as wanting to stop; they are not done. Acknowledge the misunderstanding "
    "briefly, do not treat the interview as over or suggest coming back later, and continue "
    "from the current objective."
)
CONCERN = (
    "The participant has raised a concern about the question or what is on screen: they "
    "may find it irrelevant, confusing, or repetitive. Respond to this first. Acknowledge "
    "it plainly, and if useful explain in one sentence that the purpose is {purpose}. "
    "Offer to rephrase or to skip it. Their reaction is itself useful research; do not "
    "argue or push. Do not move to a new topic in this reply. The interview continues "
    "afterwards: next turn either return to this in a better way, skip it, or move to "
    "another objective."
)
SKIPPED = "They would rather skip that. Accept it without comment and continue with the next objective."
FATIGUE = (
    "The participant sounds tired or feels this is running long. Acknowledge that briefly "
    "and warmly. {path} Keep this reply short."
)
TIME_ANSWER = "They asked about time. Answer using this real state: {timing} {path}"
STOP_OFFER = (
    "The participant would like to stop. Respect that. You may, once, mention that there "
    "is one short question left that would be useful, and make clear it is fine to finish "
    "now instead. If they still want to stop, close warmly. Do not persuade."
)
CLOSE = (
    "End the interview now. Acknowledge what they just said, do not ask anything new, and "
    "thank them sincerely in one or two sentences."
)
CLOSED = "The interview has ended. If they say more, reply briefly and warmly. Ask nothing new."
LOW_ENGAGEMENT = "Engagement seems to be dropping. Keep replies short and do not add visuals."
STALLED = "This thread has been explored enough. Move on to the next objective now."
FOCUS = (
    "Time is getting short. Prioritise what is still unresolved and most useful, keep "
    "follow-ups brief, do not open new topics, and do not revisit what is covered."
)
CLOSING_PHASE = "Very little planned time remains. Finish the current thread only and prepare to close."
OVER = (
    "The planned time is up. Acknowledge what they just said, do not start anything new, "
    "and bring the conversation to a natural close with thanks."
)
NOTHING_NEW = "Nothing new is on screen."
ON_SCREEN_WAITING = (
    "The participant can see {kind} on screen right now, asking: \"{prompt}\". They have not "
    "answered it yet. All they can do with it is {action} If they ask what it is, what it is "
    "for, or what to do with it, tell them plainly what it asks and that it is there to {value}. "
    "Never say there is nothing on screen, and never ask them to move, tap, or confirm anything "
    "it does not have."
)
ON_SCREEN_DONE = (
    "The participant can still see {kind} on screen, asking: \"{prompt}\". They have already "
    "answered it, so do not ask them to use it again. If they ask about it, refer to what they "
    "already chose. Never say there is nothing on screen, and never describe controls it does "
    "not have."
)
GENERIC_PURPOSE = "to understand their own experience"
AMBIGUOUS = (
    "Their wording is hard to read with confidence. Do not decide what they meant, and do not "
    "treat it as an answer to anything. Either ask one short question to check, or reflect back "
    "only the part you are actually sure of."
)
PARTIAL_VISUAL = (
    "They have already touched this in words, but left it vague. What is now on screen can {value}. "
    "Acknowledge what they told you first, then point them to it instead of repeating the question."
)
TOOLS_SHOWING = (
    "They are asking about what you can put on screen, so one is going up now. Say in one short "
    "sentence that you bring something up when it helps, and point them to it."
)
TOOLS_ON_SCREEN = (
    "They are asking about what you can put on screen, and something is already there waiting. "
    "Point them to it in one short sentence, describing only what it actually lets them do."
)
TOOLS_ANSWERED = (
    "They can already see {kind} on screen, asking \"{prompt}\", and they have answered it. Say in "
    "one short sentence what it was for, and refer to what they chose rather than asking again."
)
TOOLS_AVAILABLE = (
    "They are asking about what you can put on screen. Answer truthfully: you can bring up {tools} "
    "when it helps the conversation, and you use them only where they add something. Do not say "
    "you have none. Then return to the current objective."
)
TOOLS_NONE = (
    "They are asking about what you can put on screen. Answer truthfully: you can sometimes bring "
    "up a comparison, a chart, a slider, or a set of choices, and nothing useful is left for what "
    "is still open here. Do not invent one just to show the feature."
)


@dataclass
class Conductor:
    steps: list[Step]
    clock: InterviewClock
    goal: str = "how the participant currently handles a problem they care about"
    remaining: list[Step] = field(init=False)
    learned: list[str] = field(default_factory=list)   # topic keys answered well enough to retire
    partly: list[str] = field(default_factory=list)    # topic keys touched in words, still open
    on_screen: Step | None = None
    answered: bool = False
    turns: int = 0
    stop_requests: int = 0
    shortened: bool = False
    visuals_off: bool = False
    low_streak: int = 0
    detour_streak: int = 0
    stalled_turns: int = 0
    hold: int = 0  # turns to wait before offering another visual after a concern or skip
    stop_shortened: bool = False  # the path was compressed because of a stop request
    verbal_only: list[str] = field(default_factory=list)  # objectives whose visual was set aside
    stop_set_aside: list[str] = field(default_factory=list)  # set aside by a stop request, not an objection
    closed: bool = False

    def __post_init__(self) -> None:
        self.remaining = list(self.steps)

    # State the classifier and the reply model can see

    def topics(self) -> list[Topic]:
        """Planned topics the classifier may mark, including the one currently on screen."""
        pending = [self.on_screen] if self.on_screen is not None and not self.answered else []
        return [
            Topic(step.key, step.topic + (" (touched already, not settled)" if step.key in self.partly else ""))
            for step in pending + self.remaining
        ]

    def available_visuals(self) -> list[str]:
        """Plain names of visuals still usable here, so Qalvi can answer about them truthfully."""
        names: list[str] = []
        for step in self._usable_steps():
            name = VISUAL_NAME.get(step.display["type"])
            if name and name not in names:
                names.append(name)
        return names

    def visual_state(self) -> dict | None:
        """What the participant can see right now, or None when the screen is empty.

        Authoritative from the moment the display is emitted until it is answered,
        cleared, or replaced. Plain words only: no type names, no transport detail.
        """
        if self.on_screen is None:
            return None
        kind = self.on_screen.display["type"]
        return {
            "key": self.on_screen.key,
            "kind": VISUAL_NAME.get(kind, "something"),
            "prompt": self.on_screen.display["prompt"],
            "value": VISUAL_VALUE.get(kind, "help them answer"),
            "action": VISUAL_ACTION.get(kind, "answer in words."),
            "answered": self.answered,
        }

    def pending_visual(self) -> bool:
        """True while a visual is displayed and still waiting for an answer."""
        return self.on_screen is not None and not self.answered

    def on_screen_label(self) -> str | None:
        state = self.visual_state()
        if state is None:
            return None
        return f"{state['kind']}, asking \"{state['prompt']}\"" + (" (answered)" if state["answered"] else "")

    def current_objective(self) -> Step | None:
        if self.on_screen is not None and not self.answered:
            return self.on_screen
        return self._next_step()

    def stage(self, phase: str) -> str:
        """opening -> exploration -> deeper understanding -> narrowing -> wrap-up."""
        if self.closed or phase in ("closing", "over") or self.current_objective() is None:
            return "wrap-up"
        if self.shortened or phase == "focus" or len(self.remaining) <= 1:
            return "narrowing"
        if self.learned or self.partly:
            return "deeper understanding"
        return "opening" if self.turns <= 1 else "exploration"

    def anchor(self, phase: str) -> str:
        objective = self.current_objective()
        learned = ", ".join(self.learned) or "nothing yet"
        pending = [self.on_screen.key] if self.on_screen and not self.answered else []
        unresolved = ", ".join(pending + [step.key for step in self.remaining]) or "nothing"
        current = objective.topic if objective else "wrapping up what has been learned"
        touched = f"Touched but not settled: {', '.join(self.partly)}. " if self.partly else ""
        return (
            f"Research goal: {self.goal}. Current objective: {current}. "
            f"Learned so far: {learned}. {touched}Still unresolved: {unresolved}. "
            f"Stage: {self.stage(phase)}."
        )

    # One participant turn

    def turn(self, text: str, signals: Signals) -> Decision:
        decision = Decision()
        notes: list[str] = []
        intent = signals.intent

        if intent == "unclear":
            # Nothing is learned from a garbled turn: no clock start, no coverage, no visuals, no closing.
            decision.action = "clarify"
            notes.append(UNCLEAR)
            if not self.closed:
                notes += self._on_screen_note(decision) + [self.anchor(self.clock.phase())]
            decision.guidance = " ".join([f"Action for this reply: {decision.action}."] + notes)
            return decision

        self.clock.start()
        self.turns += 1

        if intent == "resume" and not (self.closed or self.stop_requests):
            intent = "continue"
        if intent == "resume":
            self.closed = False
            self.stop_requests = 0
            if self.stop_shortened:
                self.shortened = self.stop_shortened = False
            self.verbal_only = [key for key in self.verbal_only if key not in self.stop_set_aside]
            self.stop_set_aside = []
            self.hold = 1  # bridge back in words first; a visual can follow next turn
            notes.append(RESUME)
            decision.action = "acknowledge and redirect"
            intent = "continue"
            signals = Signals(intent="continue", engagement=signals.engagement,
                              covered=signals.covered, partial=signals.partial, probe=None)
        elif self.closed:
            decision.action = "wrap up"
            decision.guidance = CLOSED
            return decision

        # Never build evidence out of a guess: wording we cannot read confidently covers nothing.
        ambiguous = signals.ambiguous
        if ambiguous:
            notes.append(AMBIGUOUS)
            self.hold = max(self.hold, 1)

        # Listening and memory: only a sufficient answer retires its planned step. A topic
        # touched in words stays in the plan, because a visual may still sharpen it.
        for key in () if ambiguous else signals.covered:
            self._mark_learned(key)
        for key in () if ambiguous else signals.partial:
            if key not in self.learned and key not in self.partly:
                self.partly.append(key)
        before = len(self.remaining)
        self.remaining = [step for step in self.remaining if step.key not in self.learned]
        progressed = len(self.remaining) < before
        if self.on_screen and not self.answered and self.on_screen.key in self.learned:
            decision.clear, self.on_screen = True, None

        self.low_streak = self.low_streak + 1 if signals.engagement == "low" else 0
        if self.low_streak >= 2:
            self.visuals_off = self.shortened = True
        self.detour_streak = self.detour_streak + 1 if intent == "detour" else 0

        phase = self.clock.phase()
        timing = self.clock.describe()

        if text.strip().startswith(RESPONSE_PREFIX):
            self.answered = True
            if self.on_screen:
                self._mark_learned(self.on_screen.key)
            self.stalled_turns = 0
            decision.action = "acknowledge and probe" if signals.probe else "continue without a visual"
            notes += [ANSWER_RECEIVED, self._probe_note(signals)]
            return self._finish(decision, notes, phase, timing)

        if intent == "stop":
            self.stop_requests += 1
            if self.stop_requests == 1 and self._worth_one_more(phase):
                self.stop_shortened = not self.shortened
                self.shortened = True
                if self.on_screen is not None and not self.answered:
                    self.stop_set_aside = [self.on_screen.key]
                self._drop_visual(decision, restore=True)
                decision.action = "shorten the interview"
                notes.append(STOP_OFFER)
            else:
                return self._close(decision, notes, CLOSE)
        elif intent == "fatigue":
            self.shortened = True
            decision.action = "shorten the interview"
            notes.append(FATIGUE.format(path=self._path_summary()))
        elif intent == "time_left":
            self.shortened = True
            decision.action = "shorten the interview"
            state = timing or "There is no fixed time limit for this conversation."
            notes.append(TIME_ANSWER.format(timing=state, path=self._path_summary()))
        elif intent == "concern":
            objective = self.current_objective()
            decision.action = "clarify"
            notes.append(CONCERN.format(purpose=objective.purpose if objective else GENERIC_PURPOSE))
            self._drop_visual(decision, restore=True)
            self.hold = 1
        elif intent == "skip":
            objective = self.current_objective()
            self._drop_visual(decision)
            if objective is not None and objective in self.remaining:
                self.remaining.remove(objective)
            decision.action = "skip a planned item"
            notes.append(SKIPPED)
            self.hold = 1
        elif intent == "detour":
            decision.action = "acknowledge and redirect"
            notes.append(DETOUR_FIRM if self.detour_streak >= 2 else DETOUR_LIGHT)
        elif intent == "question":
            decision.action = "answer briefly, then redirect"
            notes.append(QUESTION)
        elif intent == "visuals":
            # Asking about the screen is itself interest, so a quiet spell does not block it.
            self.visuals_off = False
            self.low_streak = 0
            if self.pending_visual():
                # One at a time: they are asking about the thing already waiting for them.
                decision.action = "answer briefly, then redirect"
                notes.append(TOOLS_ON_SCREEN)
            else:
                # A confirmed visual may still be the one they mean, so account for it either way.
                answered = self.visual_state()
                if answered is not None:
                    notes.append(TOOLS_ANSWERED.format(**answered))
                # Explicit interest outranks a hold or an earlier set-aside: they are asking.
                step = self._next_step() if self._visual_allowed(phase) else None
                if step is not None:
                    self._show(decision, step)
                    decision.action = "show a relevant visual"
                    notes += [TOOLS_SHOWING, step.guidance, *self._partial_note(step)]
                else:
                    decision.action = "answer briefly, then redirect"
                    names = self.available_visuals()
                    notes.append(TOOLS_AVAILABLE.format(tools=_join(names)) if names else TOOLS_NONE)

        if intent == "continue":
            if self.hold:
                self.hold -= 1
            elif self._visual_allowed(phase):
                step = self._next_step()
                if step is not None and step.key not in self.verbal_only:
                    self._show(decision, step)
                    decision.action = "show a relevant visual"
                    notes += [step.guidance, *self._partial_note(step)]
                    progressed = True
            self.stalled_turns = 0 if progressed else self.stalled_turns + 1
            if decision.display is None:
                if self.stalled_turns >= STALL_TURNS and self.remaining:
                    self._advance_objective(decision)
                    decision.action = "move to the next objective"
                    notes.append(STALLED)
                elif not decision.action:
                    if ambiguous:
                        decision.action = "clarify"
                    else:
                        decision.action = "acknowledge and probe" if signals.probe else "continue without a visual"
                if decision.action != "move to the next objective" and not ambiguous:
                    notes.append(self._probe_note(signals))
        if decision.display is None:
            notes.append(NOTHING_NEW)
        return self._finish(decision, notes, phase, timing)

    # Helpers

    def _finish(self, decision: Decision, notes: list[str], phase: str, timing: str | None) -> Decision:
        notes += self._on_screen_note(decision)
        if self.visuals_off:
            notes.append(LOW_ENGAGEMENT)
        if phase == "over" and not self.closed:
            return self._close(decision, notes, OVER)
        if phase == "closing":
            notes.append(CLOSING_PHASE)
        elif phase == "focus":
            notes.append(FOCUS)
        notes.append(self.anchor(phase))
        if timing:
            notes.append(f"Timing: {timing} Mention this only if the participant asks.")
        decision.guidance = " ".join([f"Action for this reply: {decision.action}."] + notes)
        return decision

    def _close(self, decision: Decision, notes: list[str], line: str) -> Decision:
        self.closed = decision.closing = True
        self._drop_visual(decision)
        decision.display = None
        decision.action = "wrap up"
        notes.append(line)
        notes.append(self.anchor("over"))
        decision.guidance = " ".join([f"Action for this reply: {decision.action}."] + notes)
        return decision

    def _mark_learned(self, key: str) -> None:
        if key not in self.learned:
            self.learned.append(key)
        if key in self.partly:
            self.partly.remove(key)

    def _show(self, decision: Decision, step: Step) -> None:
        if step in self.remaining:
            self.remaining.remove(step)
        self.verbal_only = [key for key in self.verbal_only if key != step.key]
        self.on_screen, self.answered = step, False
        decision.display = step.display

    def _on_screen_note(self, decision: Decision) -> list[str]:
        """Carry the live visual into every reply, so Qalvi can never deny it exists.

        Skipped on the turn a visual is introduced, where its own guidance says more.
        """
        state = self.visual_state()
        if state is None or decision.display is not None:
            return []
        note = ON_SCREEN_DONE if state["answered"] else ON_SCREEN_WAITING
        return [note.format(**state)]

    def _partial_note(self, step: Step) -> list[str]:
        """A visual is still worth showing on a topic they only touched in words."""
        value = VISUAL_VALUE.get(step.display["type"])
        if step.key not in self.partly or not value:
            return []
        return [PARTIAL_VISUAL.format(value=value)]

    def _drop_visual(self, decision: Decision, restore: bool = False) -> None:
        """Take the visual off the screen; with restore, its objective returns to the plan.

        The screen is always cleared here, including a confirmed visual, so that the
        conductor never believes the screen is empty while the participant still sees one.
        """
        if self.on_screen is None:
            return
        decision.clear = True
        if not self.answered and restore and self.on_screen not in self.remaining:
            self.remaining.insert(0, self.on_screen)
            self.verbal_only.append(self.on_screen.key)
        self.on_screen, self.answered = None, False

    def _advance_objective(self, decision: Decision) -> None:
        current = self.current_objective()
        if current is not None and current in self.remaining:
            self.remaining.remove(current)
        self._drop_visual(decision)
        self.stalled_turns = 0

    def _probe_note(self, signals: Signals) -> str:
        if signals.probe is True:
            return PROBE_YES
        if signals.probe is False:
            return PROBE_NO
        return PROBE_JUDGE

    def _usable_steps(self) -> list[Step]:
        return [step for step in self.remaining if not self.shortened or step.priority == "high"]

    def _next_step(self) -> Step | None:
        return next(iter(self._usable_steps()), None)

    def _visual_allowed(self, phase: str) -> bool:
        if self.visuals_off or phase in ("closing", "over") or self.closed:
            return False
        if self.on_screen is not None and not self.answered:
            return False
        return True

    def _worth_one_more(self, phase: str) -> bool:
        return phase not in ("closing", "over") and any(step.priority == "high" for step in self.remaining)

    def _path_summary(self) -> str:
        useful = [step for step in self.remaining if step.priority == "high"]
        if not useful:
            return "Nothing important is left; offer to finish now."
        names = " and ".join(step.topic.lower() for step in useful[:2])
        count = "one short question" if len(useful) == 1 else f"{len(useful)} short questions"
        return (
            f"Only {count} would still be useful, about {names}. Offer that shortened finish "
            f"and make clear it is fine to stop now instead."
        )

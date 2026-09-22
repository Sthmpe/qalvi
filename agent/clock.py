"""Optional interview time budget: a planning signal, never a stopwatch.

The clock starts on the first committed participant turn. Active time excludes
disconnections, system failures, and absence beyond a grace period. Nothing here
is time-driven; the phase is read at turn boundaries only.
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(frozen=True)
class TimeBudget:
    max_duration: float          # seconds of active interview time
    focus_at: float = 0.30       # fraction remaining that starts the focus phase
    closing_at: float = 0.10     # fraction remaining that starts the closing phase
    closing_min: float = 60.0    # closing phase is never shorter than this
    absence_grace: float = 90.0  # silence up to this long still counts as interview time


class InterviewClock:
    def __init__(self, budget: TimeBudget | None = None, now=time.monotonic) -> None:
        self.budget = budget
        self._now = now
        self.started_at: float | None = None
        self.excluded = 0.0
        self._excluding_from: float | None = None
        self._reason: str | None = None

    @property
    def started(self) -> bool:
        return self.started_at is not None

    def start(self) -> None:
        if self.started_at is None:
            self.started_at = self._now()

    def begin_exclusion(self, reason: str, at: float | None = None) -> None:
        """Stop counting from `at` (default now); the earliest open exclusion wins."""
        if self._excluding_from is None:
            self._excluding_from = self._now() if at is None else at
            self._reason = reason

    def absence_started(self, idle_since: float) -> None:
        self.begin_exclusion("absence", idle_since + (self.budget.absence_grace if self.budget else 90.0))

    def end_exclusion(self, reason: str | None = None) -> None:
        """Resume counting. With a reason, only that kind of exclusion is ended."""
        if self._excluding_from is None or (reason is not None and reason != self._reason):
            return
        self.excluded += max(0.0, self._now() - self._excluding_from)
        self._excluding_from = self._reason = None

    def wall_elapsed(self) -> float:
        return 0.0 if self.started_at is None else self._now() - self.started_at

    def active_elapsed(self) -> float:
        if self.started_at is None:
            return 0.0
        open_exclusion = 0.0 if self._excluding_from is None else max(0.0, self._now() - self._excluding_from)
        return max(0.0, self.wall_elapsed() - self.excluded - open_exclusion)

    def remaining(self) -> float | None:
        if self.budget is None:
            return None
        return self.budget.max_duration - self.active_elapsed()

    def phase(self) -> str:
        """none (no budget) | open | focus | closing | over."""
        remaining = self.remaining()
        if remaining is None or self.budget is None:
            return "none"
        if not self.started:
            return "open"
        if remaining <= 0:
            return "over"
        budget = self.budget
        if remaining <= max(budget.max_duration * budget.closing_at, budget.closing_min):
            return "closing"
        if remaining <= budget.max_duration * budget.focus_at:
            return "focus"
        return "open"

    def describe(self) -> str | None:
        """Real timing state in plain words, for the reply model. None when there is no budget."""
        if self.budget is None:
            return None
        planned = _minutes(self.budget.max_duration)
        remaining = self.remaining() or 0.0
        if remaining <= 0:
            return f"The planned {planned} is up."
        if remaining < 60:
            return f"Less than a minute of the planned {planned} remains."
        return f"About {_minutes(remaining)} of the planned {planned} remain."


def _minutes(seconds: float) -> str:
    minutes = max(1, round(seconds / 60))
    return "1 minute" if minutes == 1 else f"{minutes} minutes"

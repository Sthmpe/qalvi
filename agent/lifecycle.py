"""Stage 2B.4B worker lifecycle: lease heartbeat and replacement-worker recovery planning.

Kept free of LiveKit imports so every crash boundary is testable on its own.

Crash boundaries and what a replacement worker does about each:

  1. Before the participant message ACK: if the row never committed there is
     nothing to recover; a typed draft keeps its stable event ID and the browser
     retries it explicitly, while lost speech must be repeated. If it committed,
     it is case 2.
  2. After the message ACK, before the control ACK: the trailing participant row
     has no control. The control is the gate before any reply, so no reply can
     have begun: classify it now, record the control, then reply.
  3. After the control ACK, before a saved reply: the reply may have reached the
     participant. It is never regenerated. The worker waits for the participant
     and flags the uncertainty.
  4. After a saved assistant row: nothing is pending.

The opening greeting follows the same rule through a durable marker written
before it is generated: marked with no saved row means "may have been heard".
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from conductor import Conductor
from recovery import CONTROL_SCHEMA_VERSION, RecoveryError, replay_conductor

LEASE_SECONDS = 30
HEARTBEAT_SECONDS = 10
TERMINAL = ("completed", "cancelled", "failed")


@dataclass(frozen=True)
class RecoveryPlan:
    conductor: Conductor
    history: list[dict]        # canonical rows in database sequence
    pending: dict | None       # case 2: classify, record control, then reply
    reply_uncertain: bool      # case 3: never regenerate
    opening_uncertain: bool    # greeting marked but never saved
    greet: bool                # nothing has started: greet normally

    @property
    def signal(self) -> str:
        """Room attribute value telling the participant UI what kind of resume this is."""
        if self.greet:
            return "fresh"
        if self.pending:
            return "answering"
        if self.reply_uncertain or self.opening_uncertain:
            return "reply_uncertain"
        return "resumed"


def plan_recovery(messages: list[dict], controls: list[dict], opening_started: bool) -> RecoveryPlan:
    """Decide how a (possibly replacement) writer continues from durable state only.

    Raises RecoveryError when stored evidence cannot support a safe continuation.
    """
    ordered = sorted(messages, key=lambda message: message["sequence"])
    if [message["sequence"] for message in ordered] != list(range(len(ordered))):
        raise RecoveryError("Canonical messages are not a contiguous database sequence")
    controlled = {record["message_id"] for record in controls}
    pending = None
    replayed = ordered
    if ordered:
        last = ordered[-1]
        if last["speaker"] == "participant" and last["id"] not in controlled and \
                last.get("control_protocol_version") == CONTROL_SCHEMA_VERSION:
            pending, replayed = last, ordered[:-1]
    conductor = replay_conductor(replayed, controls)
    last = ordered[-1] if ordered else None
    return RecoveryPlan(
        conductor=conductor,
        history=ordered,
        pending=pending,
        reply_uncertain=pending is None and last is not None and last["speaker"] == "participant",
        opening_uncertain=opening_started and not ordered,
        greet=not opening_started and not ordered,
    )


class WriterHeartbeat:
    """Keep the writer lease alive, and stop the worker the moment it must not continue.

    `beat` returns the conversation status or raises an error with a `retryable`
    attribute. A non-retryable error means this writer was replaced or released:
    stop now. Retryable failures are tolerated only while the lease could still
    be ours; past that the worker fences itself rather than risk a split brain.
    """

    def __init__(self, beat: Callable[[], Awaitable[str]], on_lost: Callable[[str], Awaitable[None]],
                 on_terminal: Callable[[str], Awaitable[None]], *, interval: float = HEARTBEAT_SECONDS,
                 lease: float = LEASE_SECONDS, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep):
        self._beat, self._on_lost, self._on_terminal = beat, on_lost, on_terminal
        self._interval, self._lease, self._clock, self._sleep = interval, lease, clock, sleep

    async def run(self) -> str:
        confirmed = self._clock()
        while True:
            await self._sleep(self._interval)
            try:
                status = await self._beat()
            except Exception as exc:  # noqa: BLE001 - classified below, never swallowed silently
                if not getattr(exc, "retryable", False):
                    await self._on_lost("stale")
                    return "stale"
                if self._clock() - confirmed >= self._lease - self._interval / 2:
                    await self._on_lost("lease_unconfirmed")
                    return "lease_unconfirmed"
                continue
            confirmed = self._clock()
            if status in TERMINAL:
                await self._on_terminal(status)
                return status

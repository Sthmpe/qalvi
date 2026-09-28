"""Versioned, deterministic control records derived from canonical messages.

This module deliberately does not start a replacement worker. Stage 2B.4B owns
loading it at Cloud job startup and resolving uncertain spoken output.
"""

from __future__ import annotations

import hashlib
import json

from clock import InterviewClock
from conductor import Conductor, Decision
from signals import Signals

CONTROL_SCHEMA_VERSION = 1
METHODOLOGY_VERSION = "real-default-v1"


class RecoveryError(Exception):
    pass


def signals_data(signals: Signals) -> dict:
    return {
        "intent": signals.intent,
        "engagement": signals.engagement,
        "covered": list(signals.covered),
        "partial": list(signals.partial),
        "probe": signals.probe,
        "ambiguous": signals.ambiguous,
    }


def conductor_state(conductor: Conductor) -> dict:
    """Only deterministic methodology fields; no model context or raw text."""
    return {
        "remaining": [step.key for step in conductor.remaining],
        "learned": list(conductor.learned),
        "partly": list(conductor.partly),
        "on_screen": conductor.on_screen.key if conductor.on_screen else None,
        "answered": conductor.answered,
        "turns": conductor.turns,
        "stop_requests": conductor.stop_requests,
        "shortened": conductor.shortened,
        "visuals_off": conductor.visuals_off,
        "low_streak": conductor.low_streak,
        "detour_streak": conductor.detour_streak,
        "stalled_turns": conductor.stalled_turns,
        "hold": conductor.hold,
        "stop_shortened": conductor.stop_shortened,
        "verbal_only": list(conductor.verbal_only),
        "stop_set_aside": list(conductor.stop_set_aside),
        "closed": conductor.closed,
    }


def state_hash(conductor: Conductor) -> str:
    canonical = json.dumps(conductor_state(conductor), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def control_data(conductor: Conductor, signals: Signals, decision: Decision) -> dict:
    return {
        "schema_version": CONTROL_SCHEMA_VERSION,
        "methodology_version": METHODOLOGY_VERSION,
        "signals": signals_data(signals),
        "decision_action": decision.action,
        "state_sha256": state_hash(conductor),
    }


def replay_conductor(messages: list[dict], controls: list[dict]) -> Conductor:
    """Replay one real-default-v1 interview without invoking the classifier.

    Legacy turns or missing/conflicting controls fail closed. A future study
    plan needs its own versioned reconstruction implementation.
    """
    conductor = Conductor([], InterviewClock())
    by_message = {record["message_id"]: record for record in controls}
    if len(by_message) != len(controls):
        raise RecoveryError("Duplicate control record")
    previous_sequence = -1
    for message in messages:
        sequence = message["sequence"]
        if sequence <= previous_sequence:
            raise RecoveryError("Canonical messages are not in database sequence")
        previous_sequence = sequence
        if message["speaker"] != "participant":
            continue
        if message.get("control_protocol_version") != CONTROL_SCHEMA_VERSION:
            raise RecoveryError("Legacy participant turn lacks the recovery invariant")
        record = by_message.pop(message["id"], None)
        if not record:
            raise RecoveryError("Canonical turn has no durable control decision")
        if record["schema_version"] != CONTROL_SCHEMA_VERSION or \
                record["methodology_version"] != METHODOLOGY_VERSION:
            raise RecoveryError("Unsupported control or methodology version")
        data = record["signals"]
        signals = Signals(
            intent=data["intent"], engagement=data["engagement"],
            covered=tuple(data["covered"]), partial=tuple(data["partial"]),
            probe=data["probe"], ambiguous=data["ambiguous"],
        )
        decision = conductor.turn(message["content"], signals)
        if decision.action != record["decision_action"] or \
                state_hash(conductor) != record["state_sha256"]:
            raise RecoveryError("Conductor replay diverged from its durable decision")
    if by_message:
        raise RecoveryError("Control record has no canonical participant message")
    return conductor

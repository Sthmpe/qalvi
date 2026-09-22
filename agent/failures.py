"""Classify session failures so each one degrades the interview as little as possible.

A speech-synthesis failure costs the participant Qalvi's voice, not the research
conversation. It must never be reported or handled as a lost connection.

Kept free of framework imports so the policy is testable on its own.
"""

from __future__ import annotations

from dataclasses import dataclass

SIGNALING = "signaling"   # LiveKit transport: the room itself is unreachable
STT = "stt"
LLM = "llm"
TTS = "tts"
TTS_RATE_LIMIT = "tts_rate_limit"
REALTIME = "realtime"
UNKNOWN = "unknown"

_ERROR_TYPES = {"stt_error": STT, "llm_error": LLM, "tts_error": TTS, "realtime_model_error": REALTIME}
VOICE_ONLY = (TTS, TTS_RATE_LIMIT)


@dataclass(frozen=True)
class Failure:
    kind: str
    recoverable: bool
    status_code: int | None = None

    @property
    def voice_only(self) -> bool:
        """True when only spoken output is lost and the interview can continue in text."""
        return self.kind in VOICE_ONLY

    @property
    def ends_voice(self) -> bool:
        """True when speech output should be switched off for the rest of the session."""
        return self.voice_only and not self.recoverable

    @property
    def stops_interview(self) -> bool:
        return not self.voice_only and not self.recoverable


def classify(error_type: str | None, recoverable: bool, status_code: int | None = None) -> Failure:
    kind = _ERROR_TYPES.get(error_type or "", UNKNOWN)
    if kind == TTS and status_code == 429:
        kind = TTS_RATE_LIMIT
    return Failure(kind=kind, recoverable=recoverable, status_code=status_code)


def from_error_event(event) -> Failure:
    """Read a LiveKit ErrorEvent without depending on the framework being importable."""
    error = getattr(event, "error", None)
    return classify(
        getattr(error, "type", None),
        bool(getattr(error, "recoverable", False)),
        getattr(getattr(error, "error", None), "status_code", None),
    )


def signaling_failure(recoverable: bool = True) -> Failure:
    """Room transport loss, which the browser handles through its own connection state."""
    return Failure(kind=SIGNALING, recoverable=recoverable)


def chat_item(item) -> tuple[str, str] | None:
    """Return (role, text) for a conversation item, or None when it carries neither.

    `conversation_item_added` emits a discriminated union. Only `message` items are
    chat messages; `agent_handoff`, `function_call`, `function_call_output`, and
    `agent_config_update` have no role and must not be read as one.
    """
    if getattr(item, "type", None) != "message":
        return None
    role = getattr(item, "role", None)
    if not isinstance(role, str):
        return None
    return role, getattr(item, "text_content", None) or ""

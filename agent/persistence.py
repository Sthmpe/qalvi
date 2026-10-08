"""Trusted, idempotent transcript writes for real LiveKit interview rooms only."""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote

import aiohttp

REAL_ROOM = re.compile(r"^qalvi-real-[0-9a-f-]{36}$")
EVENT_ID = re.compile(r"^[0-9a-fA-F-]{36}$")


class EvidenceError(Exception):
    """A canonical turn could not be confirmed as durable."""

    def __init__(self, message: str, *, retryable: bool = False, code: str | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.code = code  # PostgreSQL SQLSTATE from PostgREST, when the database answered


LEASE_HELD = "55P03"  # lock_not_available: another live worker holds the writer lease


def occurred_at(timestamp: float | None = None) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat() if timestamp else datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class SavedMessage:
    id: str
    sequence: int
    inserted: bool


class SupabaseEvidenceAPI:
    def __init__(self, url: str, secret_key: str):
        if not url.startswith("https://") or not secret_key.startswith("sb_secret_"):
            raise EvidenceError("Agent persistence is not configured with a Supabase secret key")
        self._base = url.rstrip("/") + "/rest/v1"
        self._session = aiohttp.ClientSession(
            headers={"apikey": secret_key, "Authorization": f"Bearer {secret_key}",
                     "Content-Type": "application/json"},
            timeout=aiohttp.ClientTimeout(total=8),
        )

    @classmethod
    def from_env(cls) -> "SupabaseEvidenceAPI":
        return cls(os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SECRET_KEY", ""))

    async def close(self) -> None:
        await self._session.close()

    async def request(self, method: str, path: str, body: dict | None = None):
        try:
            async with self._session.request(method, self._base + path, json=body) as response:
                if response.status >= 400:
                    code = None
                    try:
                        body = await response.json()
                        code = body.get("code") if isinstance(body, dict) else None
                    except (aiohttp.ContentTypeError, ValueError):
                        pass
                    raise EvidenceError(f"Evidence database rejected the operation ({response.status})",
                                        retryable=response.status in (408, 429) or response.status >= 500,
                                        code=code if isinstance(code, str) else None)
                return await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise EvidenceError("Evidence database acknowledgement unavailable", retryable=True) from exc

    async def rpc(self, name: str, payload: dict):
        return await self.request("POST", "/rpc/" + name, payload)


class EvidenceWriter:
    def __init__(self, api: SupabaseEvidenceAPI, conversation_id: str, generation: int,
                 job_id: str = "", opening_started: bool = False):
        self.api = api
        self.conversation_id = conversation_id
        self.generation = generation
        self.job_id = job_id
        self.opening_started = opening_started
        self._lock = asyncio.Lock()
        self._events: dict[str, tuple[str, str, str, str, bool]] = {}
        self._saved: dict[str, SavedMessage] = {}

    @classmethod
    async def claim(cls, api: SupabaseEvidenceAPI, room: str, identity: str, job_id: str,
                    lease_seconds: int = 30) -> "EvidenceWriter":
        if not REAL_ROOM.fullmatch(room):
            raise EvidenceError("Not a real interview room")
        profile_id = os.getenv("QALVI_LIVEKIT_PROFILE_ID")
        if os.getenv("LIVEKIT_AGENT_NAME") and not profile_id:
            raise EvidenceError("Named worker requires a Qalvi LiveKit profile identifier")
        if profile_id is not None and not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", profile_id):
            raise EvidenceError("Invalid worker LiveKit profile identifier")
        fields = "id,participant_id,livekit_room,status,consented_at"
        if profile_id is not None:
            fields += ",livekit_profile_id"
        rows = await api.request("GET", "/conversations?select=" + fields
                                 + "&livekit_room=eq." + quote(room, safe="") + "&limit=2")
        if len(rows) != 1 or rows[0]["livekit_room"] != room or not rows[0]["consented_at"] or \
                identity != "participant-" + rows[0]["participant_id"] or \
                rows[0]["status"] not in ("pending", "in_progress", "interrupted") or \
                (profile_id is not None and rows[0]["livekit_profile_id"] != profile_id):
            raise EvidenceError("Interview room does not match a writable participant session")
        if not job_id:
            raise EvidenceError("A writer lease requires the LiveKit job identifier")
        # One atomic claim: active resume capability, current room/profile, and no
        # other live lease. A live lease held by another job is never stolen.
        lease = await api.rpc("claim_interview_writer_lease", {
            "p_conversation_id": rows[0]["id"], "p_livekit_room": room, "p_profile_id": profile_id,
            "p_job_id": job_id, "p_lease_seconds": lease_seconds,
        })
        generation = lease.get("generation") if isinstance(lease, dict) else None
        if not isinstance(generation, int) or generation < 1:
            raise EvidenceError("Interview writer claim failed")
        return cls(api, rows[0]["id"], generation, job_id, bool(lease.get("openingStarted")))

    async def heartbeat(self, lease_seconds: int = 30) -> str:
        """Extend this writer's lease; returns the conversation status. Raises if replaced."""
        beat = await self.api.rpc("heartbeat_interview_writer", {
            "p_conversation_id": self.conversation_id, "p_writer_generation": self.generation,
            "p_job_id": self.job_id, "p_lease_seconds": lease_seconds,
        })
        status = beat.get("status") if isinstance(beat, dict) else None
        if not isinstance(status, str):
            raise EvidenceError("Heartbeat acknowledgement malformed", retryable=True)
        return status

    async def release(self) -> None:
        try:
            await self.api.rpc("release_interview_writer", {
                "p_conversation_id": self.conversation_id, "p_writer_generation": self.generation,
                "p_job_id": self.job_id,
            })
        except EvidenceError:
            pass  # an unreleased lease simply expires; a replacement waits for it

    async def mark_opening(self) -> bool:
        """Durably record that a greeting may now be generated. Must succeed first."""
        first = await self.api.rpc("mark_interview_opening", {
            "p_conversation_id": self.conversation_id, "p_writer_generation": self.generation,
        })
        if not isinstance(first, bool):
            raise EvidenceError("Opening acknowledgement malformed")
        self.opening_started = True
        return first

    async def end(self, status: str, reason: str) -> str:
        """Terminal transition by this writer; idempotent, fenced by generation."""
        result = await self.api.rpc("end_interview_conversation", {
            "p_conversation_id": self.conversation_id, "p_status": status, "p_reason": reason,
            "p_writer_generation": self.generation,
        })
        if not isinstance(result, str):
            raise EvidenceError("Ending acknowledgement malformed")
        return result

    async def load_history(self, page_size: int = 500) -> tuple[list[dict], list[dict]]:
        """Canonical rows in database sequence, and their durable control records."""
        conversation = quote(self.conversation_id, safe="")
        messages: list[dict] = []
        while True:
            page = await self.api.request(
                "GET", "/messages?select=id,sequence,speaker,channel,content,interrupted,"
                "transport_segment_id,control_protocol_version&conversation_id=eq." + conversation
                + f"&order=sequence.asc&limit={page_size}&offset={len(messages)}")
            if not isinstance(page, list):
                raise EvidenceError("Canonical history malformed", retryable=True)
            messages.extend(page)
            if len(page) < page_size:
                break
        controls = await self.api.request(
            "GET", "/interview_turn_controls?select=message_id,schema_version,methodology_version,"
            "signals,decision_action,state_sha256&conversation_id=eq." + conversation)
        if not isinstance(controls, list):
            raise EvidenceError("Control history malformed", retryable=True)
        return messages, controls

    async def append(self, key: str, speaker: str, channel: str, content: str,
                     timestamp: str, interrupted: bool = False) -> SavedMessage:
        if not key or len(key) > 200 or not content.strip() or speaker not in ("participant", "interviewer") \
                or channel not in ("voice", "text"):
            raise EvidenceError("Invalid canonical message")
        payload = (speaker, channel, content, timestamp, interrupted)
        async with self._lock:
            previous = self._events.setdefault(key, payload)
            if previous != payload:
                raise EvidenceError("Conflicting evidence event key")
            if key in self._saved:
                return self._saved[key]
            recoverable = speaker == "participant"
            args = {"p_conversation_id": self.conversation_id, "p_writer_generation": self.generation,
                    "p_event_key": key, "p_channel": channel,
                    "p_content": content, "p_occurred_at": timestamp}
            if not recoverable:
                args.update({"p_speaker": speaker, "p_interrupted": interrupted})
            uncertain = False
            for attempt in range(3):
                try:
                    rows = await self.api.rpc("append_recoverable_interview_message" if recoverable
                                              else "append_interview_message", args)
                    if not isinstance(rows, list) or len(rows) != 1:
                        raise EvidenceError("Evidence acknowledgement malformed")
                    row = rows[0]
                    saved = SavedMessage(row["message_id"], row["message_sequence"],
                                         bool(row["inserted"] or uncertain))
                    self._saved[key] = saved
                    return saved
                except EvidenceError as exc:
                    # A transport timeout may follow a successful database commit. Every retry
                    # uses the identical key and payload; the database settles the uncertainty.
                    if attempt == 2 or not exc.retryable:
                        raise
                    uncertain = True
                    await asyncio.sleep(0.2 * (attempt + 1))
            raise EvidenceError("Evidence acknowledgement unavailable")

    async def record_control(self, message_id: str, control: dict) -> None:
        if control.get("schema_version") != 1 or control.get("methodology_version") != "real-default-v1":
            raise EvidenceError("Unsupported recovery control protocol")
        payload = {
            "p_conversation_id": self.conversation_id,
            "p_writer_generation": self.generation,
            "p_message_id": message_id,
            "p_signals": control["signals"],
            "p_decision_action": control["decision_action"],
            "p_state_sha256": control["state_sha256"],
            "p_methodology_version": control["methodology_version"],
        }
        for attempt in range(3):
            try:
                result = await self.api.rpc("record_interview_turn_control", payload)
                if result != message_id:
                    raise EvidenceError("Control acknowledgement malformed")
                return
            except EvidenceError as exc:
                if attempt == 2 or not exc.retryable:
                    raise
                await asyncio.sleep(0.2 * (attempt + 1))

    async def interrupt(self) -> None:
        try:
            await self.api.rpc("transition_interview_conversation", {
                "p_conversation_id": self.conversation_id,
                "p_writer_generation": self.generation, "p_next_status": "interrupted",
            })
        except EvidenceError:
            pass  # Session is still stopped locally; a later recovery can inspect the database.


async def persist_then_continue(save, advance):
    """Small explicit gate shared by voice and typed callback tests."""
    result = await save()
    await advance(result)
    return result

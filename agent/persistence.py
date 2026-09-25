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

    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


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
                    raise EvidenceError(f"Evidence database rejected the operation ({response.status})",
                                        retryable=response.status in (408, 429) or response.status >= 500)
                return await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise EvidenceError("Evidence database acknowledgement unavailable", retryable=True) from exc

    async def rpc(self, name: str, payload: dict):
        return await self.request("POST", "/rpc/" + name, payload)


class EvidenceWriter:
    def __init__(self, api: SupabaseEvidenceAPI, conversation_id: str, generation: int):
        self.api = api
        self.conversation_id = conversation_id
        self.generation = generation
        self._lock = asyncio.Lock()
        self._events: dict[str, tuple[str, str, str, str, bool]] = {}
        self._saved: dict[str, SavedMessage] = {}

    @classmethod
    async def claim(cls, api: SupabaseEvidenceAPI, room: str, identity: str) -> "EvidenceWriter":
        if not REAL_ROOM.fullmatch(room):
            raise EvidenceError("Not a real interview room")
        rows = await api.request("GET", "/conversations?select=id,participant_id,livekit_room,status,consented_at"
                                 "&livekit_room=eq." + quote(room, safe="") + "&limit=2")
        if len(rows) != 1 or rows[0]["livekit_room"] != room or not rows[0]["consented_at"] or \
                identity != "participant-" + rows[0]["participant_id"] or \
                rows[0]["status"] not in ("pending", "in_progress", "interrupted"):
            raise EvidenceError("Interview room does not match a writable participant session")
        # A token issued before expiry might still join; the agent rejects that case.
        resumes = await api.request("GET", "/interview_resumes?select=id&conversation_id=eq."
                                    + quote(rows[0]["id"], safe="") + "&revoked_at=is.null"
                                    "&expires_at=gt." + quote(occurred_at(), safe="") + "&limit=1")
        if not resumes:
            raise EvidenceError("Interview resume has expired")
        generation = await api.rpc("claim_conversation_writer", {
            "p_conversation_id": rows[0]["id"], "p_livekit_room": room,
        })
        if not isinstance(generation, int) or generation < 1:
            raise EvidenceError("Interview writer claim failed")
        return cls(api, rows[0]["id"], generation)

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
            args = {"p_conversation_id": self.conversation_id, "p_writer_generation": self.generation,
                    "p_event_key": key, "p_speaker": speaker, "p_channel": channel,
                    "p_content": content, "p_occurred_at": timestamp, "p_interrupted": interrupted}
            uncertain = False
            for attempt in range(3):
                try:
                    rows = await self.api.rpc("append_interview_message", args)
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

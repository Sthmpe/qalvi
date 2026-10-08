"""
Qalvi voice agent: Milestone 2 voice pipeline, Milestone 3 visuals and conversational control.

    participant speaks or types -> Groq STT -> Groq LLM -> Groq TTS -> participant hears it

Each participant turn passes through one seam, Interviewer.present():
  1. the model reads the turn into a few structured signals (signals.py)
  2. the conductor combines them with the plan and the optional time budget (conductor.py)
  3. the result is a predefined visual to show or clear, plus a short note for this reply

The reply model never authors display actions. The plan guides the interview; the
participant leads it. This is still not the full interview engine (docs/INTERVIEW_ENGINE.md).

Run with:
    python main.py dev       # connects to LiveKit and waits for a room
    python main.py console   # local terminal test, no browser/LiveKit room needed
"""

import asyncio
import json
import logging
import time
from collections.abc import Callable

from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, StopResponse, cli, llm
from livekit.agents.voice.room_io import RoomOptions, TextInputEvent, TextInputOptions
from livekit.plugins import groq, silero

from clock import InterviewClock, TimeBudget
from conductor import Conductor
from failures import chat_item, from_error_event, signaling_failure
from latency import install_latency_logging
from lifecycle import LEASE_SECONDS, RecoveryPlan, WriterHeartbeat, plan_recovery
from opening import OpeningTurn
from persistence import (LEASE_HELD, REAL_ROOM, EvidenceError, EvidenceWriter, SavedMessage,
                         SupabaseEvidenceAPI, occurred_at, persist_then_continue)
from turn_input import handle_text_input
from presence import check_in_allowed, inactivity_prompt, next_check_at
from recovery import RecoveryError, control_data
from reconnect import ReconnectGrace, REFRESH_GRACE_SECONDS
from signals import Exchange, classify
from speech import SpeechFilter
from visuals import DEMO_GOAL, DISPLAY_TOPIC, demo_steps_for_room

load_dotenv()
logger = logging.getLogger("qalvi.agent")

DEMO_BUDGET = TimeBudget(max_duration=10 * 60)
USER_AWAY_TIMEOUT = 15.0  # framework default, made explicit because idle time is measured from it
VOICE_ATTRIBUTE = "qalvi.voice"  # the browser reads this to explain a silent interviewer
STATUS_ATTRIBUTE = "qalvi.session.status"  # unavailable | interrupted | completed | cancelled | failed
RECOVERY_ATTRIBUTE = "qalvi.recovery"  # fresh | resumed | answering | reply_uncertain

INSTRUCTIONS = (
    "You are Qalvi, a calm, attentive, and neutral research interviewer. This session is "
    "a short demo conversation, not a full study. Greet the participant in one short "
    "sentence, then ask a single open question about how they currently handle a problem "
    "they care about. Keep every reply to one or two short sentences. Never sell, defend, "
    "or pitch anything. "
    "You have research goals, but the person in front of you comes first. If they raise a "
    "concern, question why you are asking, or seem confused, respond to that before "
    "anything else: acknowledge it, explain the purpose briefly if it helps, and let them "
    "skip. Do not ask for what they have already told you. Ask a follow-up only when it "
    "adds something; a sufficient answer needs no 'why'. Show warmth when someone is "
    "tired, frustrated, or giving thoughtful detail, but stay concise and professional. "
    "If they want to stop, respect it. "
    "Sometimes the participant can see something on screen, such as cards, a chart, a "
    "slider, or a list of choices; you will be told when. Messages beginning with "
    "'[On screen]' are answers given that way; never say that marker aloud. These are "
    "tools you genuinely have, and you use them where they help: to compare options, put "
    "a number on something, or make a vague answer concrete. If the participant asks "
    "whether you can show anything, say so truthfully and never claim you have nothing. "
    "Describe them in plain words, never by their technical names. "
    "If what they said could mean more than one thing, do not decide for them. Check in "
    "one short question, or reflect back only what they actually said. "
    "Everything you say is spoken aloud and shown as plain text. Write it as speech: no "
    "asterisks, underscores, bullet points, headings, HTML, or other formatting, and never "
    "read a note you were given back to the participant. "
    "If asked about time, use the timing line you are given; if there is none, say there "
    "is no fixed time limit. "
    "Follow the person conversationally, but follow the research strategically. Every reply "
    "answers two questions: what does the participant need from me right now, and how do I "
    "move toward the research goal without sounding robotic. Meet the first, then return to "
    "the current objective with a natural bridge, unless they are ending the interview. "
    "Each turn you receive a short note with the action to take, the research goal, the "
    "current objective, what is learned, and what is unresolved; follow it for that reply only."
)


class EvidenceTracedLLM(groq.LLM):
    """Timing-only trace at the actual model chat invocation for live acceptance."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.last_ack: tuple[str, int] | None = None

    def chat(self, *args, **kwargs):
        kind, sequence = self.last_ack or ("opening", -1)
        logger.info("[qalvi evidence order] phase=llm_chat_begin turn=%s sequence=%d monotonic_ns=%d",
                    kind, sequence, time.monotonic_ns())
        return super().chat(*args, **kwargs)


def history_context(history: list[dict]) -> llm.ChatContext:
    """The model's context rebuilt from canonical rows only, in database sequence."""
    context = llm.ChatContext.empty()
    for row in history:
        content = row["content"] if row["channel"] != "visual" else "[On screen] " + row["content"]
        context.add_message(role="user" if row["speaker"] == "participant" else "assistant",
                            content=content, id="canonical-" + row["id"],
                            interrupted=bool(row.get("interrupted")))
    return context


class Interviewer(Agent):
    def __init__(self, room: rtc.Room, conductor: Conductor, classifier,
                 writer: EvidenceWriter | None = None,
                 traced_llm: EvidenceTracedLLM | None = None,
                 chat_ctx: llm.ChatContext | None = None) -> None:
        super().__init__(instructions=INSTRUCTIONS, **({"chat_ctx": chat_ctx} if chat_ctx else {}))
        self._room = room
        self._conductor = conductor
        self._classifier = classifier
        self._recent: list[Exchange] = []
        self._writer = writer
        self._traced_llm = traced_llm
        self._paused = False
        self._advanced_turns: set[str] = set()
        self._turn_lock = asyncio.Lock()  # voice and typed callbacks share canonical control order
        self.on_paused: Callable[[], None] | None = None  # set by the entrypoint for real interviews
        self._assistant_queue: asyncio.Queue[tuple[llm.ChatMessage, str]] | None = None

    def mark_evidence_ack(self, kind: str, sequence: int) -> None:
        if self._traced_llm:
            self._traced_llm.last_ack = (kind, sequence)
            logger.info("[qalvi evidence order] phase=db_ack turn=%s sequence=%d monotonic_ns=%d",
                        kind, sequence, time.monotonic_ns())

    async def flush_assistant(self) -> None:
        if self._assistant_queue:
            try:
                await asyncio.wait_for(self._assistant_queue.join(), timeout=15)
            except asyncio.TimeoutError as exc:
                raise EvidenceError("Prior assistant evidence was not acknowledged") from exc
        if self._paused:
            raise EvidenceError("Interview evidence is paused")

    async def pause_evidence(self) -> None:
        if self._paused:
            return
        self._paused = True
        try:
            await self._room.local_participant.set_attributes({"qalvi.session.status": "interrupted"})
        except Exception:
            logger.warning("Could not publish interview interruption state to the room")
        if self._writer:
            await self._writer.interrupt()
        if self.on_paused:
            # The interruption released the lease, so a replacement may now be
            # dispatched. Leave the room rather than linger as a second agent.
            self.on_paused()

    def fence(self) -> None:
        """This writer was replaced or its lease is unconfirmed: never write again.

        Unlike pause_evidence, it does not publish or record an interruption: the
        conversation may already be continuing under a replacement writer.
        """
        self._paused = True

    def restore(self, plan: RecoveryPlan) -> None:
        """Adopt canonical history: remembered context, and turns already advanced."""
        for row in plan.history:
            if plan.pending is not None and row["id"] == plan.pending["id"]:
                continue  # present() remembers it when the pending turn is answered
            self.remember("participant" if row["speaker"] == "participant" else "qalvi", row["content"])
            if row["speaker"] == "participant":
                self._advanced_turns.add(row["transport_segment_id"])

    async def answer_pending(self, row: dict, session: AgentSession) -> None:
        """Crash boundary 2: the saved turn has no control, so no reply can have begun."""
        key = row["transport_segment_id"]
        async with self._turn_lock:
            if self._paused or key in self._advanced_turns:
                return
            self._advanced_turns.add(key)
            self.mark_evidence_ack("recovered", row["sequence"])
            try:
                guidance = await self.present(row["content"], SavedMessage(row["id"], row["sequence"], False))
            except EvidenceError:
                await self.pause_evidence()
                return
        # The turn is already the last user message in the rebuilt context.
        session.generate_reply(instructions=guidance) if guidance else session.generate_reply()

    def remember(self, role: str, text: str) -> None:
        if text:
            self._recent = (self._recent + [Exchange(role, text)])[-8:]

    async def present(self, user_text: str, saved: object | None = None) -> str | None:
        """One participant turn: read it, decide, act on the screen, return guidance for this reply."""
        conductor = self._conductor
        try:
            signals = await classify(
                self._classifier, self._recent, user_text, conductor.topics(),
                conductor.on_screen_label(), strict=bool(self._writer),
            )
        except Exception as exc:
            if self._writer:
                raise EvidenceError("Control classification could not be confirmed") from exc
            raise
        decision = conductor.turn(user_text, signals)
        if self._writer:
            if saved is None:
                raise EvidenceError("Canonical participant message is required before control")
            await self._writer.record_control(saved.id, control_data(conductor, signals, decision))
            logger.info("[qalvi evidence order] phase=control_db_ack sequence=%d monotonic_ns=%d",
                        saved.sequence, time.monotonic_ns())
        self.remember("participant", user_text)
        if decision.clear:
            await self._room.local_participant.send_text("null", topic=DISPLAY_TOPIC)
        if decision.display is not None:
            await self._room.local_participant.send_text(json.dumps(decision.display), topic=DISPLAY_TOPIC)
        on_screen = conductor.visual_state()
        logger.info("[qalvi turn] %s", json.dumps({
            "intent": signals.intent, "engagement": signals.engagement, "covered": list(signals.covered),
            "partial": list(signals.partial), "ambiguous": signals.ambiguous,
            "phase": conductor.clock.phase(), "active_s": round(conductor.clock.active_elapsed()),
            "action": decision.action, "display": decision.display["id"] if decision.display else None,
            "clear": decision.clear, "closing": decision.closing,
            "on_screen": on_screen["key"] if on_screen else None,
            "awaiting": conductor.pending_visual(),
        }))
        return decision.guidance or None

    async def llm_node(self, chat_ctx: llm.ChatContext, tools, model_settings):
        # Last guard before the voice and the transcript: replies must be plain speech,
        # never formatting or an internal note read back to the participant.
        speech = SpeechFilter()
        async for chunk in Agent.default.llm_node(self, chat_ctx, tools, model_settings):
            if isinstance(chunk, llm.ChatChunk) and chunk.delta and chunk.delta.content:
                chunk.delta.content = speech.push(chunk.delta.content)
            yield chunk
        tail = speech.flush()
        if tail:
            yield tail

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        # Spoken turns. turn_ctx is temporary, so guidance only shapes this one reply.
        if self._paused:
            raise StopResponse()
        if self._writer:
            async with self._turn_lock:
                if self._paused:
                    raise StopResponse()
                content = new_message.text_content or ""
                if not content.strip():
                    raise StopResponse()
                key = "voice:" + new_message.id
                guidance = None
                async def advance(saved):
                    nonlocal guidance
                    if not saved.inserted:
                        raise StopResponse()
                    if key in self._advanced_turns:
                        raise StopResponse()
                    self._advanced_turns.add(key)
                    self.mark_evidence_ack("voice", saved.sequence)
                    guidance = await self.present(content, saved)
                try:
                    await self.flush_assistant()
                    await persist_then_continue(
                        lambda: self._writer.append(key, "participant", "voice", content,
                                                    occurred_at(new_message.created_at)), advance)
                except EvidenceError:
                    await self.pause_evidence()
                    raise StopResponse() from None
        else:
            guidance = await self.present(new_message.text_content or "")
        if guidance:
            turn_ctx.add_message(role="system", content=guidance)


def mic_live(participant: rtc.RemoteParticipant | None) -> bool:
    if participant is None:
        return False
    return any(
        publication.source == rtc.TrackSource.SOURCE_MICROPHONE and not publication.muted
        for publication in participant.track_publications.values()
    )


server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    real = bool(REAL_ROOM.fullmatch(ctx.room.name))
    if not real and not ctx.room.name.startswith("qalvi-demo-"):
        return
    evidence_api: SupabaseEvidenceAPI | None = None
    writer: EvidenceWriter | None = None
    real_participant = None
    plan: RecoveryPlan | None = None
    if real:
        try:
            evidence_api = SupabaseEvidenceAPI.from_env()
            real_participant = await ctx.wait_for_participant()
            writer = await EvidenceWriter.claim(evidence_api, ctx.room.name, real_participant.identity,
                                                ctx.job.id, LEASE_SECONDS)
            messages, controls = await writer.load_history()
            plan = plan_recovery(messages, controls, writer.opening_started)
        except EvidenceError as exc:
            if exc.code == LEASE_HELD:
                # Another live worker owns this interview. Leave without touching it.
                logger.info("[qalvi recovery] phase=lease_held action=exit")
            else:
                logger.error("Real interview could not acquire its evidence writer")
                if writer:
                    await writer.release()
                elif ctx.room.isconnected():
                    await ctx.room.local_participant.set_attributes({STATUS_ATTRIBUTE: "unavailable"})
            if evidence_api:
                await evidence_api.close()
            # An entrypoint that returns keeps its job connected until shutdown.
            ctx.shutdown(reason="Interview writer unavailable")
            return
        except RecoveryError as exc:
            # Stored evidence cannot support a safe continuation. Never improvise
            # around it: end the interview as failed and eject the participant.
            logger.error("[qalvi recovery] phase=integrity_failure reason=%s", exc)
            status = "failed"
            try:
                status = await writer.end("failed", "recovery_integrity")
            except EvidenceError:
                logger.error("[qalvi recovery] phase=integrity_failure_unrecorded")
            if ctx.room.isconnected():
                await ctx.room.local_participant.set_attributes({STATUS_ATTRIBUTE: status})
            await ctx.delete_room()
            if evidence_api:
                await evidence_api.close()
            ctx.shutdown(reason="Interview evidence integrity failure")
            return
        logger.info("[qalvi recovery] phase=writer_claimed generation=%d rows=%d plan=%s",
                    writer.generation, len(plan.history), plan.signal)
    stt = groq.STT(model="whisper-large-v3-turbo")
    llm_model = (EvidenceTracedLLM if real else groq.LLM)(model="openai/gpt-oss-120b")
    classifier = groq.LLM(model="openai/gpt-oss-120b", reasoning_effort="low", max_completion_tokens=300)
    tts = groq.TTS(model="canopylabs/orpheus-v1-english", voice="autumn")
    session = AgentSession(vad=silero.VAD.load(), stt=stt, llm=llm_model, tts=tts,
                           user_away_timeout=USER_AWAY_TIMEOUT,
                           **({"turn_handling": {"preemptive_generation": {"enabled": False}}}
                              if real else {}))
    install_latency_logging(session, room_name=ctx.room.name, stt=stt, llm=llm_model, tts=tts)

    steps = demo_steps_for_room(ctx.room.name)
    if plan is not None:
        # Real rooms: replayed from durable controls, never reclassified. A fresh
        # interview replays nothing and equals a newly constructed conductor.
        conductor = plan.conductor
        clock = conductor.clock
    else:
        clock = InterviewClock(DEMO_BUDGET if steps else None)
        conductor = Conductor(steps, clock, goal=DEMO_GOAL) if steps else Conductor(steps, clock)
    agent = Interviewer(ctx.room, conductor, classifier, writer,
                        llm_model if isinstance(llm_model, EvidenceTracedLLM) else None,
                        history_context(plan.history) if plan and plan.history else None)
    if plan is not None:
        agent.restore(plan)
        agent.on_paused = lambda: ctx.shutdown(reason="Interview evidence paused")
    opening = OpeningTurn()
    presence = {"nudges": 0, "task": None}
    assistant_queue: asyncio.Queue[tuple[llm.ChatMessage, str]] | None = asyncio.Queue() if writer else None
    agent._assistant_queue = assistant_queue

    async def save_assistant_items() -> None:
        assert assistant_queue is not None and writer is not None
        while True:
            item, channel = await assistant_queue.get()
            try:
                content = item.text_content or ""
                if content.strip():
                    await writer.append("assistant:" + item.id, "interviewer",
                                        channel, content,
                                        occurred_at(item.created_at), item.interrupted)
            except Exception:
                logger.error("Assistant evidence acknowledgement failed; interview interrupted")
                await agent.pause_evidence()
            finally:
                assistant_queue.task_done()

    assistant_task = asyncio.create_task(save_assistant_items()) if writer else None

    heartbeat: dict = {"task": None}

    async def close_evidence() -> None:
        if assistant_queue:
            try:
                await asyncio.wait_for(assistant_queue.join(), timeout=5)
            except asyncio.TimeoutError:
                logger.error("Assistant evidence queue did not drain before shutdown")
        if assistant_task:
            assistant_task.cancel()
        if heartbeat["task"] and heartbeat["task"] is not asyncio.current_task():
            heartbeat["task"].cancel()
        if writer:
            await writer.release()  # lets a replacement claim at once instead of waiting for expiry
        if evidence_api:
            await evidence_api.close()

    if writer:
        ctx.add_shutdown_callback(close_evidence)

    async def writer_lost(reason: str) -> None:
        # Replaced, released, or unable to confirm the lease: stop writing now and
        # leave the room to the replacement. Do not record an interruption.
        logger.warning("[qalvi recovery] phase=writer_lost reason=%s", reason)
        agent.fence()
        try:
            await session.aclose()
        finally:
            ctx.shutdown(reason="Writer lease lost")

    async def conversation_ended(status: str) -> None:
        # Cancelled or ended elsewhere: eject the participant from this worker's own
        # LiveKit project (the server outbox does the same with its credentials).
        logger.info("[qalvi recovery] phase=terminal status=%s action=eject", status)
        agent.fence()
        try:
            await ctx.room.local_participant.set_attributes({STATUS_ATTRIBUTE: status})
        except Exception:
            logger.warning("Could not publish the interview ending to the room")
        try:
            await ctx.delete_room()
        finally:
            try:
                await session.aclose()
            finally:
                ctx.shutdown(reason=f"Interview {status}")

    async def expire_refresh_grace() -> None:
        try:
            if writer and conductor.closed:
                # The conversation closed naturally and the participant left: complete it.
                status = await writer.end("completed", "interview_closed")
                agent.fence()
                await ctx.room.local_participant.set_attributes({STATUS_ATTRIBUTE: status})
            else:
                await agent.pause_evidence()
        except EvidenceError:
            await agent.pause_evidence()
        finally:
            try:
                await session.aclose()
            finally:
                ctx.shutdown(reason="Participant refresh grace expired")

    reconnect_grace = ReconnectGrace(
        real_participant.identity, expire_refresh_grace,
        present=lambda: real_participant.identity in ctx.room.remote_participants,
    ) if real_participant else None
    if reconnect_grace:
        ctx.add_shutdown_callback(reconnect_grace.close)

    def participant() -> rtc.RemoteParticipant | None:
        return next(iter(ctx.room.remote_participants.values()), None)

    # Active time: exclude disconnection, failures, and absence beyond the grace period.
    @ctx.room.on("participant_disconnected")
    def on_participant_left(_participant: rtc.RemoteParticipant) -> None:
        if reconnect_grace and not reconnect_grace.disconnected(_participant.identity):
            return
        logger.info("[qalvi failure] %s", json.dumps({"kind": signaling_failure().kind, "recoverable": True}))
        clock.begin_exclusion("disconnected")
        if reconnect_grace:
            logger.info("[qalvi recovery] phase=grace_started seconds=%d", REFRESH_GRACE_SECONDS)

    @ctx.room.on("participant_connected")
    def on_participant_joined(_participant: rtc.RemoteParticipant) -> None:
        if reconnect_grace and not reconnect_grace.connected(_participant.identity):
            return
        clock.end_exclusion("disconnected")
        if reconnect_grace:
            logger.info("[qalvi recovery] phase=participant_reconnected")

    voice = {"available": True, "task": None}

    async def end_voice() -> None:
        # Speech output only. STT, the LLM, the conductor, and visuals are untouched,
        # so the participant may keep speaking or typing and read the replies.
        session.output.set_audio_enabled(False)
        await ctx.room.local_participant.set_attributes({VOICE_ATTRIBUTE: "unavailable"})

    @session.on("error")
    def on_error(event) -> None:
        failure = from_error_event(event)
        logger.warning("[qalvi failure] %s", json.dumps({
            "kind": failure.kind, "recoverable": failure.recoverable,
            "status_code": failure.status_code, "voice_only": failure.voice_only,
        }))
        if not failure.voice_only:
            clock.begin_exclusion("failure")
        if failure.ends_voice and voice["available"]:
            voice["available"] = False
            voice["task"] = asyncio.create_task(end_voice())

    @session.on("agent_state_changed")
    def on_agent_state(event) -> None:
        if event.new_state == "speaking":
            clock.end_exclusion("failure")

    @session.on("conversation_item_added")
    def on_item(event) -> None:
        entry = chat_item(event.item)
        if entry is None:
            return  # agent handoffs and tool items carry no role or transcript text
        role, text = entry
        if role == "assistant":
            agent.remember("qalvi", text)
            if assistant_queue is not None and not agent._paused:
                assistant_queue.put_nowait((event.item, "voice" if voice["available"] else "text"))
        elif role == "user":
            clock.end_exclusion()
            presence["nudges"] = 0

    def stop_watching() -> None:
        if presence["task"]:
            presence["task"].cancel()
            presence["task"] = None

    # Inactivity: check in at most twice, only while the agent is idle and the participant silent.
    async def watch_inactivity(idle_since: float) -> None:
        while True:
            due = next_check_at(presence["nudges"], mic_live(participant()))
            if due is None:
                return
            await asyncio.sleep(max(0.0, idle_since + due - time.monotonic()))
            if reconnect_grace and real_participant.identity not in ctx.room.remote_participants:
                return
            if not check_in_allowed(session.user_state == "away", session.agent_state == "listening",
                                    conductor.pending_visual()):
                return
            prompt = inactivity_prompt(time.monotonic() - idle_since, presence["nudges"], mic_live(participant()))
            if prompt is None:
                return
            presence["nudges"] += 1
            session.generate_reply(instructions=prompt)

    @session.on("user_state_changed")
    def on_user_state(event) -> None:
        now = time.monotonic()
        if event.new_state == "away":
            stop_watching()  # never leave two watchers racing to speak
            if not conductor.pending_visual():
                clock.absence_started(now - USER_AWAY_TIMEOUT)
            presence["task"] = asyncio.create_task(watch_inactivity(now - USER_AWAY_TIMEOUT))
        elif event.old_state == "away":
            clock.end_exclusion("absence")
            stop_watching()

    async def on_text_input(sess: AgentSession, event: TextInputEvent) -> None:
        await handle_text_input(sess, event, agent, writer, ctx.room,
                                real_participant.identity if real_participant else None)

    await session.start(
        agent=agent,
        room=ctx.room,
        record=False,  # transcript consent does not authorize Cloud audio/session recording
        room_options=RoomOptions(text_input=TextInputOptions(text_input_cb=on_text_input),
                                 close_on_disconnect=not real),
    )
    if real:
        logger.info("[qalvi recovery] phase=session_started close_on_disconnect=false grace_seconds=%d recording_enabled=%s",
                    REFRESH_GRACE_SECONDS, any(session._opts.recording_options.values()))
    if writer and plan is not None:
        heartbeat["task"] = asyncio.create_task(WriterHeartbeat(
            lambda: writer.heartbeat(LEASE_SECONDS), writer_lost, conversation_ended).run())
        await ctx.wait_for_participant(identity=real_participant.identity)
        await ctx.room.local_participant.set_attributes({RECOVERY_ATTRIBUTE: plan.signal})
        if plan.greet:
            try:
                await writer.mark_opening()  # durable BEFORE the greeting may be heard
            except EvidenceError:
                await agent.pause_evidence()
                return
            await opening.start(session, lambda: ctx.wait_for_participant(identity=real_participant.identity),
                                fresh=True)
        elif plan.pending is not None:
            await agent.answer_pending(plan.pending, session)
        # Otherwise the last reply was saved, or may already have been heard: never
        # regenerate it. Qalvi waits for the participant, who sees the transcript.
        return
    wait_for_opening = (lambda: ctx.wait_for_participant(identity=real_participant.identity)) \
        if real_participant else ctx.wait_for_participant
    if not await opening.start(session, wait_for_opening, fresh=None):
        await ctx.room.local_participant.set_attributes({STATUS_ATTRIBUTE: "unavailable"})
        await session.aclose()
        ctx.shutdown(reason="Interview session unavailable")


if __name__ == "__main__":
    cli.run_app(server)

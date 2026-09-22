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

from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli, llm
from livekit.agents.voice.room_io import RoomOptions, TextInputEvent, TextInputOptions
from livekit.plugins import groq, silero

from clock import InterviewClock, TimeBudget
from conductor import Conductor
from failures import chat_item, from_error_event, signaling_failure
from latency import install_latency_logging
from opening import OpeningTurn
from presence import check_in_allowed, inactivity_prompt, next_check_at
from signals import Exchange, classify
from speech import SpeechFilter
from visuals import DEMO_GOAL, DISPLAY_TOPIC, demo_steps_for_room

load_dotenv()
logger = logging.getLogger("qalvi.agent")

DEMO_BUDGET = TimeBudget(max_duration=10 * 60)
USER_AWAY_TIMEOUT = 15.0  # framework default, made explicit because idle time is measured from it
VOICE_ATTRIBUTE = "qalvi.voice"  # the browser reads this to explain a silent interviewer

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


class Interviewer(Agent):
    def __init__(self, room: rtc.Room, conductor: Conductor, classifier) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._room = room
        self._conductor = conductor
        self._classifier = classifier
        self._recent: list[Exchange] = []

    def remember(self, role: str, text: str) -> None:
        if text:
            self._recent = (self._recent + [Exchange(role, text)])[-8:]

    async def present(self, user_text: str) -> str | None:
        """One participant turn: read it, decide, act on the screen, return guidance for this reply."""
        conductor = self._conductor
        signals = await classify(
            self._classifier, self._recent, user_text, conductor.topics(), conductor.on_screen_label(),
        )
        decision = conductor.turn(user_text, signals)
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
    stt = groq.STT(model="whisper-large-v3-turbo")
    llm_model = groq.LLM(model="openai/gpt-oss-120b")
    classifier = groq.LLM(model="openai/gpt-oss-120b", reasoning_effort="low", max_completion_tokens=300)
    tts = groq.TTS(model="canopylabs/orpheus-v1-english", voice="autumn")
    session = AgentSession(vad=silero.VAD.load(), stt=stt, llm=llm_model, tts=tts,
                           user_away_timeout=USER_AWAY_TIMEOUT)
    install_latency_logging(session, room_name=ctx.room.name, stt=stt, llm=llm_model, tts=tts)

    steps = demo_steps_for_room(ctx.room.name)
    clock = InterviewClock(DEMO_BUDGET if steps else None)
    conductor = Conductor(steps, clock, goal=DEMO_GOAL) if steps else Conductor(steps, clock)
    agent = Interviewer(ctx.room, conductor, classifier)
    opening = OpeningTurn()
    presence = {"nudges": 0, "task": None}

    def participant() -> rtc.RemoteParticipant | None:
        return next(iter(ctx.room.remote_participants.values()), None)

    # Active time: exclude disconnection, failures, and absence beyond the grace period.
    @ctx.room.on("participant_disconnected")
    def on_participant_left(_participant: rtc.RemoteParticipant) -> None:
        logger.info("[qalvi failure] %s", json.dumps({"kind": signaling_failure().kind, "recoverable": True}))
        clock.begin_exclusion("disconnected")

    @ctx.room.on("participant_connected")
    def on_participant_joined(_participant: rtc.RemoteParticipant) -> None:
        clock.end_exclusion("disconnected")

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
        # Typed messages and on-screen answers skip on_user_turn_completed, so the same
        # seam runs here. Mirrors the framework default: interrupt, then reply.
        async with sess._claim_user_turn():
            await sess.interrupt()
            guidance = await agent.present(event.text)
            if guidance:
                sess.generate_reply(user_input=event.text, instructions=guidance)
            else:
                sess.generate_reply(user_input=event.text)

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=RoomOptions(text_input=TextInputOptions(text_input_cb=on_text_input)),
    )
    if not await opening.start(session, ctx.wait_for_participant):
        await ctx.room.local_participant.set_attributes({"qalvi.session.status": "unavailable"})
        await session.aclose()


if __name__ == "__main__":
    cli.run_app(server)

"""
Qalvi voice agent — Milestone 2 proof-of-concept.

This is the smallest possible LiveKit Agents worker that proves the real
end-to-end voice path:

    participant speaks -> Groq STT -> Groq LLM -> Groq TTS -> participant hears it

It is intentionally NOT the final PMF interview engine (docs/INTERVIEW_ENGINE.md).
There are no objectives, findings, studies, or Korra-specific content here —
just a short, neutral, generic conversation to prove the transport works.

Run with:
    python main.py dev       # connects to LiveKit and waits for a room
    python main.py console   # local terminal test, no browser/LiveKit room needed
"""

from dotenv import load_dotenv

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import groq, silero

load_dotenv()

INSTRUCTIONS = (
    "You are Qalvi, a calm and neutral AI research interviewer. "
    "This particular session is a short technical proof of the realtime "
    "voice pipeline, not a full study. Greet the participant in one short "
    "sentence, then ask a single open, neutral question about how they "
    "currently handle a problem they care about. Keep every response to "
    "one or two short sentences. Never sell, defend, or pitch anything — "
    "you are only listening and asking neutral follow-up questions."
)

server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=groq.STT(),
        llm=groq.LLM(),
        tts=groq.TTS(),
    )

    agent = Agent(instructions=INSTRUCTIONS)

    await session.start(agent=agent, room=ctx.room)
    await session.generate_reply(
        instructions="Greet the participant briefly and ask your first question."
    )


if __name__ == "__main__":
    cli.run_app(server)

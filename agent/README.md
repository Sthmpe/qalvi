# Qalvi Voice Agent (Milestone 2 proof-of-concept)

A small Python [LiveKit Agents](https://docs.livekit.io/agents/) worker that
joins the same LiveKit room as the participant's browser and runs a
Groq-powered STT → LLM → TTS pipeline. See `../AGENTS.md` and `../docs/` for
product context — this service intentionally contains no interview-engine,
Supabase, or Korra-specific logic yet.

## Setup

```bash
cd agent
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# then fill in .env with your real LiveKit + Groq credentials
```

## Run

```bash
python main.py dev
```

This connects the worker to your LiveKit project and waits for a room —
when a participant joins from the Next.js app, LiveKit dispatches this
agent into that room automatically (no explicit dispatch config needed for
this proof-of-concept).

To sanity-check the Groq STT/LLM/TTS pipeline directly from your terminal,
without the browser or a LiveKit room at all:

```bash
python main.py console
```

## Required environment variables

| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | Your LiveKit Cloud/server WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit API key (server-side only) |
| `LIVEKIT_API_SECRET` | LiveKit API secret (server-side only) |
| `GROQ_API_KEY` | Groq API key for STT (Whisper), the LLM, and TTS |

These must match the `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
used by the Next.js app's `.env.local` — both sides join the same LiveKit
project.

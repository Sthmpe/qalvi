# Qalvi Voice Agent

A small Python [LiveKit Agents](https://docs.livekit.io/agents/) worker that
joins the same LiveKit room as the participant's browser and runs a
Groq-powered STT → LLM → TTS pipeline. See `../AGENTS.md` and `../docs/` for
product context. Real interview rooms use an agent-only Supabase secret key to
persist canonical transcript evidence. Demo rooms never write real evidence.

## Visuals and conversational control (Milestone 3)

`visuals.py` holds the demo plan: four predefined visuals (comparison cards, bar
chart, slider, multiple choice), each with a topic key, purpose, and priority.
They are tools, not mandatory steps.

Every participant turn passes through `Interviewer.present()`:

1. `signals.py` asks the model for a small structured reading of the turn
   (intent, engagement, covered topics, whether a follow-up is useful). Failures
   or timeouts fall back to neutral signals.
2. `conductor.py` combines that with the plan and the optional `clock.py` time
   budget and decides whether to show a visual (JSON on the `qalvi.display`
   text stream), clear one (`null` on the same stream), continue, shorten, or close.
3. The reply model receives a one-turn note. It never authors visuals.

Answers come back on `lk.chat` prefixed `[On screen]`. Every note carries the
research anchor (goal, current objective, learned, unresolved, stage) and the
action chosen. Concerns are addressed before the plan advances; detours and
participant questions are bridged back; fatigue compresses the path; stop intent
closes unless corrected; garbled input learns nothing; covered topics are not
asked again. `presence.py` allows at most two gentle check-ins
after genuine inactivity. The demo plan and its ten-minute budget apply only to
`qalvi-demo-*` rooms; other rooms have no visuals and no budget. Requires
`livekit-agents >= 1.8`.

## When speech synthesis fails

`failures.py` classifies session errors (signaling, `stt`, `llm`, `tts`, `tts_rate_limit`).
A TTS failure is voice-only: on the first unrecoverable one the agent disables audio
output, publishes `qalvi.voice: "unavailable"`, and the interview continues in text
with the transcript, conductor state, and visuals intact. Without this, LiveKit closes
the session after three consecutive unrecoverable errors. Voice does not come back
within a session, and there is no second TTS provider yet.

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
| `SUPABASE_URL` | Qalvi Supabase project URL for real interview persistence |
| `SUPABASE_SECRET_KEY` | Agent-only `sb_secret_` key for privileged evidence RPCs |

These must match the `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
used by the Next.js app's `.env.local` — both sides join the same LiveKit
project.

Real interview rooms also need `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the
agent runtime. Do not place that key in a browser variable or log it. The agent
resolves the room to a consented conversation, claims a fenced writer generation,
and writes canonical participant turns before reply generation. Completed
assistant conversation items are stored with their interruption flag. Typed
participant input receives a `qalvi.evidence` acknowledgement only after the
database confirms the write. The demo rooms retain their original behavior and
do not write evidence. Microphone audio is not recorded.

## Development latency diagnostics

Run the frontend with `npm run dev`. Agent timing logs are enabled by
`python main.py dev` / `console`, or explicitly by `QALVI_ENV=development`
on a development deployment. They are off for ordinary `start` deployments.
No model, transcript content, credentials, or interview behavior is changed.

Filter the browser console and agent logs for `[qalvi latency]`:

| Stage | Measurement |
| --- | --- |
| Speech end | `user_speech_end_detected` marks the VAD event; user `turn_metrics.stopped_speaking_at_ms` gives the SDK's speech-end timestamp. |
| STT | `stt_final` marks receipt inside the agent. User `transcription_delay_ms` measures speech end to transcription. Browser `transcript_final_received` includes forwarding/network delay. |
| Turn detection | `end_of_turn_delay_ms` measures the wait before committing the turn. |
| LLM | `llm_metrics.ttft_ms` and `turn_metrics.llm_node_ttft_ms` measure first token; `llm_node_ttfs_ms` includes buffering until the first sentence reaches TTS. |
| TTS | `tts_metrics.ttfb_ms` measures provider first audio. `tts_node_ttfb_ms` includes the node's text buffering. |
| Playback | Assistant `started_speaking_at_ms`, `playback_latency_ms` and `e2e_latency_ms` describe server audio output. Browser `browser_playback_start` is the HTML audio element's actual `playing` event. |

Important measurement boundaries: server playback is audio handed to the room,
not sound heard by the participant. A continuous WebRTC track may fire the browser
`playing` event only once, not on every reply. Neither metric measures speaker
hardware latency. Browser timestamps and agent timestamps are separate clocks;
do not subtract them to claim precise network latency. Use room IDs and provider
request IDs to correlate records, and compare durations within the same clock.
Per-plugin metrics arrive after the request finishes; their TTFT/TTFB fields
measure first output, not the log emission time. Missing metrics mean unavailable,
not zero. Pipeline stages overlap, so do not simply add all durations together.

To collect a baseline, speak a short turn, a longer turn, then switch to text and
back to voice without leaving the room. Check that each utterance has one final
transcript row and that follow-up questions retain context. Save timing records
for those turns before making model or latency changes. No real latency baseline
has been recorded by the offline regression tests.

Local regression checks (no API requests):

```powershell
npm test                              # from the repository root
cd agent
.venv\Scripts\python.exe -m unittest test_conductor.py test_clock.py test_visuals.py test_latency.py
```

After changing agent code, redeploy the LiveKit Cloud agent from the repository
root with `tools\livekit\lk.exe agent deploy agent`.

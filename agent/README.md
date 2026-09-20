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
node --test tests/interview.test.mjs # from the repository root
cd agent
.venv\Scripts\python.exe -m unittest test_latency.py
```

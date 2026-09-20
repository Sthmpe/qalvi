# Qalvi Development Roadmap

## Milestone 0 — Foundation

Goal:
A clean Next.js application runs locally.

Tasks:
- initialize Next.js
- TypeScript
- Tailwind
- ESLint
- establish folder structure
- create documentation
- Git repository

No product features yet.

## Milestone 1 — Basic Interview Room

Goal:
A participant can open an interview page.

Tasks:
- basic interview UI
- participant messages
- AI messages
- simple interview state
- temporary mock study

No database required initially if unnecessary.

## Milestone 2 — Live Voice

Status: Complete — 2026-09-20. End-to-end validation confirmed.

Goal:
Participant can speak naturally with AI.

Tasks:
- LiveKit integration
- microphone
- turn detection
- STT
- LLM
- TTS
- live transcript
- ability to type instead
- switch between voice and text

Delivered and validated:
- realtime LiveKit voice proven end-to-end
- Groq Whisper STT (`whisper-large-v3-turbo`)
- Groq-hosted GPT-OSS 120B LLM (`openai/gpt-oss-120b`)
- Groq Orpheus TTS (`canopylabs/orpheus-v1-english`, voice `autumn`)
- Python agent deployed to LiveKit Cloud because the local CPU cannot run the native inference dependency
- voice/text switching within one LiveKit session, preserving conversation context
- transcript deduplication using stable segment IDs, with interim updates and single finalization
- development-only latency diagnostics for speech end, STT final, LLM first token, TTS first audio, and playback

Validation: TypeScript, lint, production build, and nine regression tests passed.
Live latency baselines remain to be collected with the diagnostics; no model or latency optimization was included.

## Milestone 3 — Interactive Visuals

Status: Not started.

Goal:
AI can display interactive research material during interview.

Initial components:
- bar chart
- comparison cards
- slider
- multiple choice

Participant interactions become interview evidence.

## Milestone 4 — Supabase Persistence

Goal:
Studies and interviews survive reloads.

Store:
- studies
- objectives
- participants
- interviews
- messages
- findings
- visual interactions

## Milestone 5 — Generic Study System

Goal:
Korra is no longer hard-coded.

Founder can create/configure a study.

Public study link launches appropriate interview.

## Milestone 6 — Founder Results

Goal:
Founder can review completed research.

Initial results:
- interview list
- transcripts
- participant summaries
- findings
- objections
- commitment signals
- objective coverage

## Milestone 7 — Korra Pilot

Use Qalvi with real merchants.

Learn from actual participant behaviour.

Improve Qalvi based on real usage.

## Later

Only after evidence:

- AI study creator
- cross-interview synthesis
- voice improvements
- additional visual types
- pricing experiments
- prototype testing
- participant recruitment
- billing
- teams
- enterprise

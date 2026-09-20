# Qalvi Decision Log

## 2026-09-19 — Project created

Working product name: Qalvi.

## Framework

Decision:
Use Next.js rather than Flutter Web.

Reason:
Qalvi is primarily a web SaaS with public interview links, realtime voice, dynamic React components, charts, SEO pages and server APIs.

## Voice

Decision:
Live voice is part of V0/V1 rather than a later feature.

Technology:
LiveKit.

Reason:
Conversation quality is central to the product experience.

Participants should also be able to type.

No camera required.

## AI

Decision:
Start with Groq due to low/free initial cost.

Architecture must allow other AI providers later.

## Research Philosophy

Decision:
Qalvi should not simply automate questionnaires.

It must conduct adaptive qualitative research while remaining neutral and evidence-driven.

## Visuals

Decision:
AI may request predefined visual components.

AI must not generate arbitrary frontend scripts during interviews.

## First Study

Decision:
Korra will be the first real study.

Korra-specific logic must not be built into Qalvi's core architecture.

## Product Position

Current hypothesis:

Qalvi is not simply an AI interview tool.

It is an AI-powered PMF/customer-research experimentation platform capable of combining conversation with live interactive concept testing.

This positioning remains a hypothesis and should change if user evidence suggests otherwise.

## 2026-09-20 — Milestone 2 complete

Decision:
Accept Milestone 2 as complete after end-to-end realtime voice validation and the interview-room quality fixes.

Validated voice pipeline:
- LiveKit realtime transport between the participant browser and the Python agent
- Groq Whisper STT: `whisper-large-v3-turbo`
- Groq-hosted GPT-OSS 120B LLM: `openai/gpt-oss-120b`
- Groq Orpheus TTS: `canopylabs/orpheus-v1-english`, voice `autumn`

Deployment:
Run the agent on LiveKit Cloud because the local development CPU cannot run the native inference dependency. The cloud deployment proved the voice pipeline end-to-end without changing the agreed providers or models.

Interview-room behavior:
- Voice and typed input share one LiveKit session and agent conversation. Switching modes preserves context; typed messages use `lk.chat` instead of the old mock engine.
- Transcript streams update rows by participant identity and stable LiveKit segment ID. Interim snapshots and final streams must not create separate utterances, and late interim events must not overwrite finalized text.
- Development-only diagnostics record speech-end detection, final STT, LLM first-token latency, TTS first-audio latency, and playback timing without logging transcript content or credentials.

Validation:
TypeScript, lint, production build, and nine regression tests passed. End-to-end voice validation is complete. A measured live latency baseline is separate from that functional validation and remains to be collected before further optimization; browser playback and server output timings have different measurement boundaries.

Scope:
Preserve the current UI and models. Milestone 3 has not started.

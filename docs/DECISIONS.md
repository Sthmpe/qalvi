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

This original positioning is superseded by the M2.5 positioning decision below.

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

## 2026-09-22 — M2.5 product and UI foundation

Qalvi is an AI-powered conversation and research platform for founders, product teams, researchers, sales teams, agencies, and other teams conducting structured conversations with customers, prospects, users, or communities. It is not a personal assistant or recruitment/job-interview product.

Current use cases: customer discovery, PMF research, product research, concept testing, pricing research, customer feedback, sales discovery/client conversations, and conversational surveys/research.

Raw interview evidence is the source of truth. AI-generated findings are derived from it and never replace it. Use Study → Participant → Conversation → Raw Evidence → Derived Findings. Researchers must be able to inspect/search/filter original messages, independently of interpretations.

Build a researcher shell and local-data workspace before Milestone 3 to establish the product foundation. Use charcoal, off-white, indigo, local Geist, a glowing Qalvi orb, restrained cards, generous spacing, and deliberate desktop/mobile layouts. Scope the visual tokens to researcher and invitation surfaces; preserve the validated realtime room and provider configuration.

Use a `(research)` route group for `/dashboard`, `/studies`, `/studies/new`, and `/studies/[studyId]` with overview, interviews, participants, findings, and settings. `/interview/[studyId]` sits outside the shell. `/interview/demo` retains the live flow. `/` opens the research dashboard.

Counts and findings derive from clearly labeled local fixtures. The brief is unsaved page state; settings are read-only. Copied participant links open sample invitations. The test interview opens the shared LiveKit agent, not a study-specific interview. Source-message links demonstrate traceability but no real interview evidence is saved.

Deferred: Supabase, authentication, billing, team permissions, real study creation, study-specific agent configuration, AI findings generation, OpenRouter/model switching, recruitment/job interviews, and interactive visuals. Milestone 3 remains unstarted. M2.5 changes remain uncommitted pending a separate user request.

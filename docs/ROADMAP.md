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

## M2.5 — Product and UI Foundation

Status: Implemented — 2026-09-22. Local UI foundation; no persistence or real study creation.

Delivered:
- conversation and research positioning for founders, product, research, sales, agencies, and other teams
- distinct researcher workspace and participant experiences
- evidence hierarchy: Study → Participant → Conversation → Raw Evidence → Derived Findings
- responsive researcher shell, dashboard, study library, and nested study workspace
- reusable navigation, cards, buttons, badges, headings, empty states, and Qalvi orb
- charcoal/off-white/indigo visual identity with local Geist fonts
- sample transcript search/speaker filtering and derived findings linked to original messages
- unsaved local research-brief preview, read-only settings, participant invitation preview
- preserved `/interview/demo` LiveKit voice/text flow, deduplication, and latency diagnostics

Excluded: Supabase, auth, billing, team permissions, real study creation, study-specific agent setup, AI findings generation, new models/OpenRouter, recruitment/job interviews, and Milestone 3 interactive visuals.

This previews later researcher workflows; it does not complete the persistence, study-system, or results-backend milestones below.

Validation: `npx tsc --noEmit`, `npm run lint`, and `npm run build` passed, along with all seven existing interview regression tests. Browser inspection covered desktop (1440px), tablet (768px), and mobile (390px/320px), source links, search/filtering, brief preview, clipboard success/failure, reduced motion, and unknown study IDs. No inspected page overflow or runtime exceptions. The existing development slow-filesystem warning remains. No new cloud voice session was exercised; live transport/agent code is unchanged. Changes remain uncommitted.

## Milestone 3 — Interactive Visuals

Status: Complete — 2026-09-23. Live acceptance passed after the adaptive conversational control, active-visual lifecycle, and plain-speech fixes below.

Goal:
AI can display interactive research material during interview.

Initial components:
- bar chart
- comparison cards
- slider
- multiple choice

Participant interactions become interview evidence.

Delivered:
- one `DisplayAction` union for exactly these four types, validated at the browser boundary before rendering
- one predefined React component per type inside the evolved `VisualStage`; the M1 `ConceptCard` and mock data were removed
- the agent sends actions over the `qalvi.display` text stream; application code (`agent/visuals.py`) decides when, the LLM only receives a per-turn note about what is on screen
- on-screen answers travel back over the existing `lk.chat` path, prefixed `[On screen]`, and appear in the session transcript as participant evidence
- a deterministic preview of all four visuals at `/interview/demo/visuals`
- regression tests: 18 Node tests (validation, summaries, session transport, replay and send races) and 6 Python tests (demo-room gate, sequence, latency)
- conversational control at the single per-turn seam: model-read signals (intent, engagement, covered topics, follow-up value) combined by a small conductor with the plan and an optional time budget; concerns are addressed before the plan advances, fatigue and stop intent shorten or close, covered topics are retired, visuals are tools rather than steps, and a `null` display clears the screen
- optional time budget (starts on first participant turn, active-time exclusions, focus/closing/over phases, real timing answers, no countdown) and conservative inactivity check-ins
- goal anchoring in every reply note (goal, current objective, learned, unresolved, stage) with natural redirection for detours and participant questions, stop-intent correction, unintelligible-input handling, and a stall guard against endless exploration
- text-only degradation when speech synthesis fails (TTS 429 no longer closes the session), failure classification, and an `AgentHandoff` crash fix in the conversation-item callback
- coverage strength (untouched, partially answered, sufficiently answered) so a topic mentioned in passing keeps its visual, tool awareness so Qalvi answers truthfully about what it can show and can surface a relevant unused visual on request, and an ambiguity guard so unclear wording never becomes evidence
- an authoritative active-visual lifecycle (emitted, waiting, answered, cleared or replaced) carried into every reply, so Qalvi explains what is on screen instead of denying it, plus a check-in guard so one participant turn cannot produce repeated questions, and a plain-speech filter that keeps markdown, HTML entities, and internal markers out of the voice and the transcript
- regression tests now: 32 Node tests and 89 Python tests (conductor scenarios, visuals as tools, active visual lifecycle and supported interactions, ambiguity, plain speech, clock, presence, signal parsing, visuals, failures, opening, latency)

Final acceptance pass: TypeScript, lint, production build, and Node regression tests passed.
Both participant pages passed browser checks at 320, 390, 768, and 1440px, including
editable draft answers and gallery-only confirmations. The first live room connected and
the AI answered typed input, but no visual appeared, and the agent followed its planned sequence rather than the participant. The conductor above replaced that behaviour, and later live runs drove the visual-lifecycle, duplicate-question, TTS fallback, and plain-speech fixes. Live acceptance passed on 2026-09-23.

Excluded: LLM-chosen or LLM-authored display actions, study-specific visual configuration, persistence of interactions (Milestone 4), Recharts (not needed for these four), and any visual types beyond the four above.

## Milestone 4 — Supabase Persistence

Goal:
Studies and interviews survive reloads.

Status: Stage 1 migrations deployed to Qalvi; Stage 2A accepted and complete on 2026-09-24.

Stage 1 delivered:
- Supabase project directory with `config.toml` and three fail-closed migrations
- profiles, workspaces, membership, studies, pseudonymous participants, conversations, immutable messages, visual displays and responses, findings, and finding evidence links
- composite-key tenancy, row level security on every table, column grants, no anonymous access
- integrity triggers binding every role: immutable evidence, visual answers validated against what was shown, findings that must cite supporting evidence, cited messages that cannot be deleted alone
- `create_workspace` and `create_finding` for the operations that need one transaction
- minimal browser, server, and server-only elevated Supabase clients
- 25 database tests running the real migrations on in-process Postgres as each Supabase role

Stage 2A delivered: researcher sign-in/sign-out, verified claims, researcher-route session refresh and protection, workspace lookup and first-workspace bootstrap, a public participant route boundary, and linked-project generated TypeScript types. The researcher pages still use sample study data. The Qalvi project has all three migrations applied; linked database lint and anonymous access checks passed. Live sign-in, session refresh, protected navigation, sign-out, repeat sign-in, and single-workspace bootstrap passed acceptance with a real researcher account.

Stage 2B (not started): persisting live interviews and reading real study/evidence data in the researcher workspace.

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

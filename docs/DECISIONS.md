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

## 2026-09-22 — Milestone 3 interactive visuals

Decision:
Support exactly four visuals (comparison cards, bar chart, slider, multiple choice) with the smallest architecture that fits them: one discriminated `DisplayAction` union, one hand-written validator, one component per type, and the existing `VisualStage` as the switch. No registry, plugin system, schema engine, or component factory. The M1 `ConceptCard` and mock data were replaced rather than kept alongside.

Reason:
Rule 2 and rule 7. Four fixed types do not justify an extensibility layer, and a hand-written validator keeps the boundary explicit: the AI supplies data, never markup or code.

Transport:
Reuse the M2 LiveKit session. The agent sends a visual on the `qalvi.display` text stream. The participant's answer goes back on `lk.chat`, the same path as typed input, prefixed `[On screen]`, so the LLM sees one conversation and the transcript records the answer as participant evidence.

Triggering:
In M3 application code decides when a visual appears (a fixed demo sequence, one visual per spoken or typed turn). The LLM receives a short per-turn note describing what is on screen and what to ask. It does not choose or author display actions. Connecting constrained LLM-triggered visuals is a later decision.

Text input:
LiveKit Agents runs `on_user_turn_completed` for speech only, so a text-input callback that mirrors the framework default (interrupt, then reply) runs the same visual logic for typed messages. Session behaviour for typed text is otherwise unchanged. `livekit-agents` is pinned to `~=1.8` for `RoomOptions` and `TextInputOptions`.

Charts:
The bar chart is rendered with plain elements from supplied values. Recharts stays uninstalled until a visual needs it.

Copy:
Product copy avoids em dashes.

### Final M3 acceptance, 2026-09-22

Keep the existing cloud deployment unchanged at the user's request. It predates
M3, so local validation does not establish live M3 acceptance. M3 remains
implemented with acceptance pending, not complete; M4 has not started.

The fixed visual sequence is restricted to `qalvi-demo-*` rooms and must not be
used as the default logic for future real studies. Replayed visual IDs are ignored;
stale callbacks cannot resubmit an answer, and a completed send cannot lock a newer
visual. Agent guidance uses the current confirmation labels and explicitly says
not to speak the `[On screen]` transport marker. These agent changes require a
future approved deployment and live verification.

## 2026-09-22 — Adaptive conversational control and optional time budget

Decision:
The first live M3 test showed Qalvi following its planned visual sequence instead of responding to the participant. Replace the fixed sequence with one small control layer at the existing per-turn seam. The model reads each participant turn into a few structured signals (intent, engagement, covered topics, follow-up value); a deterministic conductor combines them with the plan and the optional time budget; the reply model gets a short note for that reply only.

Principles:
The research plan guides the interview; it does not control the human. Concerns are addressed before the plan advances and are treated as evidence. Fatigue and stop intent shorten or close the interview; a shorter path may be offered once, never twice. Covered topics are not asked again. Visuals are tools, not steps: they can be shown, skipped, cleared, or switched off as engagement drops. Follow-ups are asked when useful, not mechanically.

Time budget:
Optional per study. Starts on the first committed participant turn. Active time excludes disconnections, failures, and silence beyond a 90-second grace; ordinary pauses and typing count. Focus at 30% remaining, closing at 10% remaining with a 60-second minimum, over at zero. Evaluated only at turn boundaries, so time never interrupts speech or typing; reaching the budget lets the current response finish, acknowledges it, and closes naturally. No participant-visible countdown. These are configurable defaults; the demo uses ten minutes.

Inactivity:
At most two gentle check-ins after genuine mutual idleness (60 seconds, 120 in text mode), only while Qalvi is listening and the participant is silent. Never a repeated nag.

Cost:
One extra short model call per turn for the signals, using the same Groq model at low reasoning with a two-second timeout and neutral fallback. No new dependencies, no persistence, no study engine.

### Addendum, 2026-09-22: goal anchoring

Natural conversation must not lose the research goal. The conductor now carries a research anchor (goal, current objective, learned, unresolved, stage) into every reply note, labels each reply with the decision principle chosen, and handles detours, participant questions, stop corrections, and unintelligible input. Objectives set aside because of a concern return to the plan verbal-only; objectives set aside by a misread stop return in full when the participant corrects it. A stall guard moves to the next objective after three on-topic turns without progress. Still one conductor, no second orchestration layer, same model and provider.

## 2026-09-22 — A TTS failure must not end the interview

Decision:
Groq TTS returned HTTP 429 repeatedly in the first live M3 run. LiveKit retried three times per turn, emitted an unrecoverable `TTSError`, and closed the `AgentSession` once four consecutive turns had failed (`SessionConnectOptions.max_unrecoverable_errors` defaults to 3). The research conversation died for a speech-output problem.

Degrade instead of dying: on the first unrecoverable TTS error, switch the session to text-only with the framework's own `session.output.set_audio_enabled(False)` and tell the browser through a `qalvi.voice` attribute. LiveKit only runs synthesis when audio output is enabled, so no further TTS calls are made, no further errors are counted, and the session stays alive with transcript, conductor state, visuals, draft, and context intact.

Not done:
No second TTS provider and no provider failover yet. No automatic voice recovery inside a session, because retrying is what killed the session. No change to the Groq STT or LLM models, the conductor, or the visual schemas.

Also fixed:
`conversation_item_added` read `event.item.role` on every item and crashed on `AgentHandoff`. Items are now narrowed on the union's own `type` discriminator; only `message` items carry a role.

Participant-facing copy names no provider: the room says Qalvi's voice is unavailable for now, replies appear as text, and speaking or typing both still work.

## 2026-09-22 — Visuals are tools, and coverage has strength

Decision:
The first live acceptance run produced no visuals at all. The classifier marked a topic
`covered` as soon as the participant mentioned it in passing, and the conductor deleted
that step, and its visual, from the plan. A talkative participant could retire every
visual without ever answering anything precisely. When they then asked why no chart or
selection had appeared, Qalvi replied that none were part of the interview, which was
false.

Coverage is now reported at two strengths. `covered` means answered well enough that
asking again in any form adds nothing, and retires the step as before. `partial` means
touched but left vague, and keeps the step, because a predefined visual can still
quantify, compare, expose a tradeoff, reveal a preference, or give an easier way to
answer. `VISUAL_VALUE` names that value per visual type so the reply model introduces
the visual as a way to sharpen what was said rather than repeating the question.

The interviewer also knows its own tools. `Conductor.available_visuals()` lists unused
visual types in plain words, and a `visuals` intent covers a participant asking about or
asking for one. Qalvi points at what is already on screen, brings up a relevant unused
visual when they show interest (explicit interest outranks a hold or an earlier
set-aside), or says truthfully what it can show and why nothing is going up now. It
never denies having visuals, never names the schema or transport, and does not launch
one during wrap-up to demonstrate the feature.

A third signal, `ambiguous`, stops Qalvi inventing an answer. In the live run,
"is it okay jottin it down" was answered as though the participant had described
shifting work tasks. An ambiguous turn now records no coverage and offers no visual;
the reply checks in or reflects back only what was actually said.

Not done:
No study or objective engine, no per-objective evidence model, no scoring. Coverage
strength is two flags and one list on the conductor. Same conductor, same models,
same visual schemas and transport, same time budget and stop, fatigue, and detour
behaviour.

## 2026-09-22 — The screen state is the conductor's, and replies are speech

Decision:
Three defects from the same live transcript.

Qalvi could deny that a visual existed while one was rendered and waiting for the
participant. It only learned about a visual when the `[On screen]` answer came back,
because the note describing a visual was attached to the turn that emitted it and
never repeated. `Conductor.visual_state()` is now the authoritative record from
emission until the visual is answered, cleared, or replaced, and every reply note
carries it: the question it asks, its kind in plain words, what it is for, and whether
it is still waiting. Clearing became symmetrical, including for confirmed visuals, so
the conductor never believes the screen is empty while the participant sees something.
A visual already on screen is explained when asked about, not swapped out.

One participant turn produced three near-identical questions about the interruption
percentage. The source was not the reply path but the inactivity watcher: a participant
reading a slider and deciding looks idle, so after 60 and 120 seconds it called
`generate_reply` twice more, and the model restated the question in context both times.
`presence.check_in_allowed()` now treats a pending visual as participation, the clock
opens no absence exclusion during one, and a new watcher cancels any previous one.

Internal presentation syntax reached the participant: an HTML entity, a repeated
`[On screen]` marker, and markdown emphasis around a button label. `agent/speech.py`
filters the reply in `Interviewer.llm_node`, which is upstream of both synthesis and
text forwarding, so speech, transcript, and stored chat item are cleaned in one pass at
whitespace boundaries without delaying the first spoken words. `[On screen]` remains
the evidence marker on the participant's own on-screen answers.

Not done:
No UI change, no provider change, no second orchestration layer, no dedupe of rendered
text. The filter strips presentation syntax only and never rewrites what Qalvi said.

## 2026-09-23 — M3 accepted; M4 Stage 1 persistence foundation

M3 passed live acceptance and is complete. M4 has started.

Decision:
Supabase Auth and PostgreSQL, with the schema defined by migrations in
`supabase/migrations`, never by dashboard edits. Stage 1 is the foundation
only: schema, integrity rules, access policies, and minimal client utilities.
The app is not yet wired to the database.

Tenancy is structural. Every row below a study carries `workspace_id` and
`study_id` and references its parent through a composite key containing both,
so no row can point across a study or workspace even if a policy is wrong.

Raw evidence is immutable for every role, including the service role:
`messages`, `visual_displays`, and `visual_responses` reject updates by
trigger. Researchers can read it but never write it; only trusted server code
records evidence. Only final transcript segments are stored, and a unique
transport segment id makes retried writes idempotent.

On-screen answers are stored as both a participant message on the `visual`
channel and a structured `visual_response` linked to that message and to the
`visual_display` it answered. The message keeps the transcript whole and gives
findings one uniform thing to cite; the response keeps the exact value
queryable; the display records what was actually offered, which is the only way
to interpret an answer later and the only record of a visual nobody answered.
A trigger rejects an answer that does not match what was shown.

Findings are derived and editable, but must always cite at least one supporting
message, checked at commit. They may also cite counter-evidence. A cited
message cannot be deleted on its own; a whole study can be.

Participants are pseudonymous and never sign in: an alias, an optional segment,
no contact details, no link across studies. `anon` has no access to anything;
participant traffic will go through the interview server.

JSONB only where the shape genuinely varies: the display snapshot, interviewer
provenance, and AI finding metadata.

Dependencies added: `@supabase/supabase-js` and `@supabase/ssr` (the Supabase
clients), `server-only` (turns an accidental client import of the service-role
client into a build error), and `@electric-sql/pglite` as a dev dependency so
the migrations run against real Postgres in `npm test` without Docker.

Not done:
No app reads or writes, no authentication UI, no session-refresh proxy, no
generated database types, no study objectives table, no AI findings pipeline,
no team management, no participant contact storage.

## 2026-09-24 — M4 Stage 2A researcher authentication

The linked project is Qalvi (`ohcykqteunevdkqijxdm`). The three Stage 1
migrations were reviewed, dry-run, and applied in order with stable Supabase CLI
2.117.0, invoked through `npx` without adding a project dependency. Remote
migration history matches all three files. Linked database lint reports no
schema errors. Catalog checks confirm RLS, policies, triggers, composite keys,
and indexes; anonymous Data API reads are denied on all eleven tables.
Security Advisor reports the intentional `authenticated` execution grant on
`public.create_workspace`, a `SECURITY DEFINER` function needed for first-owner
bootstrap. Anonymous callers have no execute grant, and the function checks
`auth.uid()`.

Researcher authentication uses the project's publishable key, verified
`auth.getClaims()`, server-side cookie clients, and a Next.js 16 route proxy for
session refresh. The researcher layout verifies identity again. First-workspace
creation runs after sign-in or an explicit setup action, never during a page
render; later refreshes and sign-ins look up the existing workspace. Participant
routes remain public. The secret-key client stays server-only and unused.

`src/types/database.ts` is generated from the linked public schema. The local
research pages still show sample studies and the participant interview still
uses its existing session-local flow. Stage 2B persistence has not started.
Live Stage 2A acceptance passed with a real researcher account on 2026-09-24.
Before first sign-in, the linked project had one Auth user and profile but no
workspace or membership. First sign-in created exactly one workspace and one
owner membership. Browser testing confirmed protected navigation, session
persistence across refresh, sign-out protection, and restoration of that same
workspace on a later sign-in. A separate headless Chrome run repeated those
steps and recorded no browser console errors. Linked authenticated-role checks
showed access to the researcher's own workspace, rejected a nonmember
workspace ID, and showed no direct insert grant for raw messages or
membership. The 25 migration/RLS tests passed, including tests with two
distinct tenants. Supabase logs showed one failed credential attempt with a
localhost:3000 referer, expected anonymous
permission denials from earlier security checks, and one malformed read-only
diagnostic query; none occurred in the successful browser run. Stage 2A is
complete. Stage 2B has not started.

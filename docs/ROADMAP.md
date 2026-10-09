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

Status: Stage 1 and Stage 2B.1 database migrations deployed to Qalvi; Stage 2A accepted and complete on 2026-09-24. Stage 2B.2 gateway and linked-project HTTP acceptance completed on 2026-09-25. Stage 2B.3 agent-side canonical transcript writes passed linked database and controlled Cloud WebRTC acceptance and were accepted on 2026-09-25. Stage 2B.4A (durable recovery, same-worker reconnect and LiveKit primary-to-backup failover) passed Acceptance A on 2026-10-07 and Acceptance B on 2026-10-08 and is CLOSED (master `1357341`). Stage 2B.4B (writer lease, replacement recovery, completion/cancellation/ejection) is implemented on `stage-2b4b-lifecycle` and passed automated real-LiveKit acceptance on 2026-10-08; its participant lifecycle UI is integrated on `stage-2b4b-integration` and passed real-browser live acceptance on 2026-10-09; it remains OPEN pending the human microphone session, a spoken-turn replacement and a deployed outbox scheduler.

Stage 1 delivered:
- Supabase project directory with `config.toml` and three fail-closed migrations
- profiles, workspaces, membership, studies, pseudonymous participants, conversations, immutable messages, visual displays and responses, findings, and finding evidence links
- composite-key tenancy, row level security on every table, column grants, no anonymous access
- integrity triggers binding every role: immutable evidence, visual answers validated against what was shown, findings that must cite supporting evidence, cited messages that cannot be deleted alone
- `create_workspace` and `create_finding` for the operations that need one transaction
- minimal browser, server, and server-only elevated Supabase clients
- 25 database tests running the real migrations on in-process Postgres as each Supabase role

Stage 2A delivered: researcher sign-in/sign-out, verified claims, researcher-route session refresh and protection, workspace lookup and first-workspace bootstrap, a public participant route boundary, and linked-project generated TypeScript types. The researcher pages still use sample study data. The Qalvi project has all three migrations applied; linked database lint and anonymous access checks passed. Live sign-in, session refresh, protected navigation, sign-out, repeat sign-in, and single-workspace bootstrap passed acceptance with a real researcher account.

Stage 2B.1 (database foundation): the migration and security tests are implemented.
It adds single-use, seven-day invitation metadata, separate hashed resume capabilities
limited to 24 hours, explicit consent version/time, writer fencing, ordered idempotent
message append, lifecycle transitions, and issued/rendered visual evidence. The linked
dry-run listed only `20260924000100_live_interview_foundation.sql`; it was then
applied to the linked Qalvi project. Linked migration history, schema lint,
anonymous-access denials, and regenerated TypeScript types were verified.

Stage 2B.2 gateway: authenticated researchers can issue a seven-day, single-use
invitation for an active study visible through their own RLS session. A participant
opens the link without consuming it, explicitly agrees to transcript storage,
then POSTs to claim it. The server sets a separate 24-hour HTTP-only resume
cookie and issues short-lived LiveKit access from the saved conversation, never
from browser-supplied room, identity, or tenancy IDs. The demo remains separate.
The researcher study library retains sample fixtures; a small connected-study
panel exposes invitation issuance only when an active real study exists.
An isolated linked-project acceptance fixture passed authenticated issuance,
draft/foreign/signed-out denial, passive invitation GET, consent, single claim,
hashed resume, refresh, server-derived token scope, reuse/forgery rejection, and
cancellation. The fixture was removed. A WebRTC agent conversation was not run
for this gateway-only stage.
Cancellation blocks new Qalvi session access but does not yet remove a connected
LiveKit participant or invalidate an already issued five-minute token. Address
this with the real-session lifecycle in Stage 2B.4.

Stage 2B.3 delivered: a real-room-only Python writer resolves the
server-created LiveKit room to one consented conversation and participant,
claims a fenced writer generation, and appends completed voice and typed turns
through the ordered, idempotent Stage 2B.1 RPC. Real-room preemptive generation
is disabled. The voice callback and typed stream handler await a durable append
before Qalvi advances. Real typed sends carry a stable application event ID and
the browser waits for a same-room evidence acknowledgement before clearing the
draft. Assistant conversation items persist forwarded text and the SDK
interruption flag. Bounded retries use the same event key and payload; failure
pauses the agent and attempts to mark the conversation interrupted. The demo
remains on its existing local-only behavior. Linked-project acceptance passed
for room mapping, invitation claim, ordered voice/text/assistant rows,
lost-acknowledgement retry, idempotency, writer fencing, and anonymous denial.
Controlled Cloud acceptance used a real WebRTC room and an audio-published
participant. One completed STT voice turn produced one canonical participant
message; the assistant opening, voice response, typed response, and their
participant turns reconstructed in database sequence. Agent timing logs showed
the voice database acknowledgement 536 ms before LLM chat invocation, and the
typed acknowledgement 493 ms before its LLM chat invocation. Same-key typed
retry produced no duplicate evidence. A separate linked-project failure
injection confirmed that an unacknowledged turn pauses without advancing the
LLM, while retrying a lost acknowledgement resolves to the existing row.
Temporary acceptance fixtures were removed. A longer audio sample split into
two distinct final STT turns, so turn segmentation remains dependent on VAD/STT.

Stage 2B.4A (CLOSED 2026-10-08; the dated history below ends with the closure record): version-marked participant turns,
one immutable derived control record per processed turn, a service-only resume
recovery read, and browser reconstruction from canonical database sequence.
The real agent must acknowledge both the participant message and its control
decision before reply generation. An uncertain typed draft keeps its stable
event ID in tab-scoped storage and requires explicit retry. The linked recovery
migration is applied, generated types are refreshed, and local Node, Python,
TypeScript, lint and production-build checks pass. Live browser acceptance is
still open: a real invitation and consent produced one participant room and an
automatic LiveKit dispatch, but the Cloud worker did not join that room during
the controlled test. No voice/text evidence or refresh result is claimed from
that stalled live run. The narrow same-origin consent-form compatibility fix is
covered by a gateway regression test.

The LiveKit multi-profile failover foundation was also delivered within
2B.4A. It adds server-only ordered project profiles, named explicit dispatch
with a bounded worker-assignment wait, and a service-only compare-and-swap
transport rotation before any writer/evidence exists. The same conversation
survives a pre-interview project switch. The existing single-project automatic
dispatch remains the default when profiles are unset. The linked primary
gateway exercised the new profile schema on 2026-10-07, but no second-project
live failover acceptance is claimed. This foundation does not close 2B.4A or
start 2B.4B.

Stage 2B.4B remains separate: replacement Cloud worker reconstruction and
generation takeover, heartbeat/lease and stale-session cleanup, cancellation
ejection/token revocation with durable retries, and human browser/microphone
acceptance. Visual display/response persistence and researcher evidence reads
remain later work. No findings generation or analytics are included.

The initial 2026-10-07 acceptance remained incomplete. The existing primary was deployed as
`qalvi-interview-primary` and successfully assigned the one fresh real session;
its previous quota/assignment failure did not occur, so live failover and backup
profile fencing were not exercised. Voice and typed turns each passed observed
message-ACK, control-ACK, reply-generation ordering. Seven canonical rows
reconstructed after refresh, and saved controls replayed without classification.
Continuing after refresh failed: the SDK's default immediate disconnect closure
had stopped the agent session while its room participant remained visible.
A real-session-only 120-second reconnect grace fixes that lifecycle locally,
with identity fencing, bounded expiry and regression tests. Its live retest and
two-project failover acceptance remain outstanding. The user retained the
one-session limit. Stage 2B.4A is not accepted or closed, and no checkpoint commit
is authorized by this incomplete acceptance.

Corrective validation passed 106 Node tests (including database/RLS), 108
Python tests, TypeScript, lint, production build, diff checks and exact-value
source/client-bundle credential scans. The SDK recording option is now
explicitly disabled in source; that correction is not deployed or live verified.
A local cleanup migration fixes control-record deletion through the existing
canonical-parent cascade while retaining direct immutability and all grants/RLS.
It is not applied remotely. The cancelled, archived fixture's canonical rows
remain pending that migration; its capabilities and temporary Auth account were
removed. Its retained IDs are recorded in DECISIONS.

Later corrective acceptance on 2026-10-07 applied the forward cleanup migration
`20261007000100`; remote history and dry-run confirmed the schema is current.
The previously archived fixture now cascades safely without changing unrelated
evidence or privileged grants. Both existing workers received the corrected
source: primary `UUEPp5yezJfq`, backup `3QzkQUTG44KT`. Primary runtime confirmed
the 120-second grace and disabled SDK recording.

The first corrective live session exposed an additional provider-room lifetime
bug: the room disappeared about 25 seconds after participant departure despite
agent grace. Named room creation now specifies a 150-second departure timeout.
The second and final allowed fresh session passed refresh/reconnect, a subsequent
participant/assistant turn, stable-ID draft retry with one canonical row, and
database sequence/control replay. Browser polling was allowed to catch up;
the harness's Unicode equality check was corrected without changing the UI.
The two-session cap is exhausted. Controlled primary-to-backup failover remains
unverified, so Stage 2B.4A is still OPEN and no acceptance checkpoint is committed.
Stage 2B.4B remains deferred.

Final corrective validation passed 106 Node tests (including DB/RLS), 108
Python tests, TypeScript, lint, production build, diff and credential/bundle
checks. Terminal access and writer checks passed. Both cancelled acceptance
fixtures and their temporary researcher were cleaned without changing unrelated
evidence. These passing recovery checks do not substitute for live failover.

**Stage 2B.4A: CLOSED (2026-10-08).** Acceptance A (same-worker refresh and
reconnect, stable-ID draft retry, canonical sequence and control replay) passed
on 2026-10-07 and was not repeated. Acceptance B passed on 2026-10-08 with one
fresh session. Only the Next.js server's primary agent target was overridden, for
that run, to a name no worker serves; both deployments, priorities and enabled
flags were unchanged. The primary room received a named dispatch that LiveKit
never assigned. After the configured 45-second wait the router classified
`assignment_timeout` (46.5 s from dispatch to rotation; the browser's first token
request returned 202 after 53 s) and rotated the same participant and conversation
once, from `primary`/generation 1 to `backup_1`/generation 2, with a new room.
The sleeping backup worker cold-started and was assigned 10.3 s after its dispatch
(second token request 200 after 16.6 s). It claimed writer generation 1 against
the `backup_1` conversation and wrote the opening, a typed participant turn with
message then control acknowledgement before reply generation, and the reply.
No participant joined the primary room. Live probes confirmed stale-generation
rotation, rotation of the active session, and a stale lease are all refused.
The primary target was restored, and the disposable fixture and both rooms were
removed with unrelated row counts unchanged.

Applied migrations through 2B.4A: `20260924000100`, `20260927000100`,
`20260929000100` and `20261007000100`. Local files match remote history
statement for statement. Primary worker `UUEPp5yezJfq`, backup `3QzkQUTG44KT`.
Known limitations carried into Stage 2B.4B: no replacement worker after worker
loss; after grace expiry a participant can rejoin a room with no agent; natural
completion is recorded as `interrupted`; a shutdown racing grace expiry can leave
`in_progress`; cancellation does not eject a connected participant; no
mid-interview cross-project failover. Stage 2B.4B is not started.

**Stage 2B.4B: OPEN (implemented and automated-live-accepted 2026-10-08).**
Branch `stage-2b4b-lifecycle` from the accepted 2B.4A checkpoint. Migrations
`20261008000100` (writer lease, recovery reservation, opening marker, terminal
transition, ejection outbox) and `20261009000100` (heartbeat reports
server-recorded endings to the current writer) are applied remotely; linked lint
passed. Primary `6UsqFczaqMPv` and backup `8su99bUN5iL3` run the 2B.4B worker
(previous versions `UUEPp5yezJfq` and `3QzkQUTG44KT` remain available for rollback).

Delivered:
- a server-clock writer lease (30 s, 10 s heartbeat); no lease stealing; the
  takeover reservation fences the lapsed generation at once
- replacement dispatch into the conversation's own room and project from the
  token route and `POST /interview/api/recover`; bounded, at most three attempts
- reconstruction from canonical rows and durable controls without
  reclassification; each crash boundary handled (uncontrolled turn answered once,
  controlled turn never regenerated, durable opening marker, saved reply resumes)
- `completed` on participant end or natural close, `cancelled` by researcher,
  `failed` on damaged history, `interrupted` otherwise; `ended_at` and reasons
- ejection through a durable outbox with backoff and through the worker's own
  heartbeat; `POST /interview/api/end`, researcher cancel, scheduler drain route
- every LiveKit server call bounded so a slow region fails over instead of hanging
- every early worker exit shuts the job down; grace expiry checks real presence
- the UI lifecycle contract for Codex in ARCHITECTURE

Automated live acceptance: one continuous session 18/18 (fresh lease, heartbeat,
refresh without takeover, boundaries 4, 2 and 3, fencing, researcher cancel and
ejection, terminal refusal), participant end 3/3, worker-side ejection with an
undrained outbox 3/3, and post-grace replacement without re-greeting. Validation:
Node 131/131 (database/RLS 48), Python 127/127, TypeScript, lint, build.

Participant lifecycle UI is implemented on `stage-2b4b-ui`: bounded replacement
recovery, truthful `qalvi.recovery` expectations, interruption/resume, transport
switching, uncertain replies, terminal/expired read-only states, and confirmed
participant ending. Canonical reads and retries preserve evidence/draft identity;
late requests cannot revive terminal interviews. Researcher cancellation UI is
not attached to the existing sample-only evidence screen; its API is unchanged.

Remaining before closure: a human microphone/device session; a spoken-turn
replacement; a scheduler for `/api/internal/lifecycle-outbox` in deployment.
Mid-interview cross-project failover and an aggregate routing deadline remain out
of scope.

Integration and final live acceptance (2026-10-09, branch `stage-2b4b-integration`
from the UI checkpoint `1b8a575`, itself on the backend `f522ea1`). The UI uses the
backend contract unchanged. One server fix: the public demo had no interviewer,
because the demo route relied on unnamed automatic dispatch and every deployed
worker is named; the demo now asks for the named worker of the profile that shares
its legacy project. Validation: Node 149/149, Python 127/127, TypeScript, lint,
build, exact-value credential scan of source and browser bundle (13 values, 0 hits).

Real-browser acceptance against the real backend and LiveKit Cloud (headless Chrome,
typed turns, crash boundaries injected through the service role):
- demo greets again
- lifecycle 13/13: greeting without a false delay notice, refresh offers Resume
  and keeps the same writer, denied microphone notice, replacement after a saved
  reply (resumed, no re-greeting), replacement with an unconfirmed reply (shown
  truthfully, never regenerated), explicit typed-draft retry creating exactly one
  row, End Interview dialog to thanks with room ejection, no polling afterwards
- cancelled 2/2, expired 2/2, failed 2/2 in 6 of 7 runs
- backup project: replacement in the backup room (generation 1 to 3), evidence
  continued without a second greeting, participant end, room ejected
- internal outbox route: 404 without or with a wrong secret; with the secret it
  drained a primary and a backup row with each project's credentials; a repeat
  call drained nothing

Open findings: in one failed-path run the old worker exited normally after being
fenced, but that browser never requested recovery (not reproduced in six further
runs). The first backup-routed session after the backup worker scaled to zero was
assigned a job within 17 s but the browser never joined; a warm repeat passed. The
inline drain on ending takes the five oldest due rows, so with an undrained backlog
the ending's own room is ejected by the worker heartbeat instead.

Stage 2B.4B remains OPEN. Still required: a human microphone/device session and a
spoken-turn replacement (the user must perform them), and a deployed scheduler for
`/api/internal/lifecycle-outbox`. The Next.js app is not deployed anywhere: the
Vercel CLI has no credentials and the repository has no project link or other
hosting configuration, so no scheduler can be configured or verified. Needed: a
publicly reachable deployment holding `QALVI_INTERNAL_TASK_SECRET`, plus a
recurring authenticated POST (for example Vercel Cron, or Supabase pg_cron with
pg_net).

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

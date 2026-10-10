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

## 2026-09-24 — M4 Stage 2B.1 database foundation

The approved Stage 2B.1 scope is database primitives and security tests only.
Extend the Stage 1 evidence schema rather than create a second transcript model.
Invitation and resume bearer tokens are separate opaque capabilities; only
SHA-256-sized hashes are stored. Invitations are single-use and expire within
seven days. Resume capabilities expire within 24 hours. Claiming will require
an intentional server-side action after explicit transcript-storage consent;
participants remain outside researcher Auth. No audio is persisted by default.

Trusted `service_role` RPCs derive tenancy from saved invitation/conversation
records, require an active writer generation, and allocate message sequence
under a row lock. Repeated event keys return the original immutable message
only for an identical payload. Raw-message insert/update grants for researcher
and anonymous clients remain denied. Visual actions are recorded as issued
before transport, with a distinct one-time rendered acknowledgement; visual
answers write a message and structured response atomically.

The migration and expanded PGlite/RLS tests pass locally. The linked dry-run
listed only `20260924000100_live_interview_foundation.sql`; it was applied to
Qalvi after explicit approval. Linked migration history, database lint, and
anonymous Data API denials passed, and public-schema TypeScript types were
regenerated. No API, agent, browser, or researcher UI integration is part of
this stage.

Installed LiveKit Agents code shows that `on_user_turn_completed` is awaited
before speech scheduling, but default preemptive generation can begin LLM work
before the callback returns. Stage 2B.3 must explicitly gate that path before
using the callback as a persist-before-generation boundary. No agent behavior
has been modified in Stage 2B.1.

## 2026-09-25 — M4 Stage 2B.2 participant gateway

Keep researcher authorization on the existing RLS client. Use the separate
server-only elevated client only after study/member checks to insert invitation
metadata and call the Stage 2B.1 claim/resume RPCs. An invitation GET is passive;
the participant explicitly consents to transcript storage in a POST. The resume
capability is a distinct random bearer held only in an HTTP-only cookie, while
the database stores its hash and controls expiry/revocation. The continuing URL
contains no invitation or resume token.

Real LiveKit tokens derive room and participant identity from the resolved
database conversation. The browser cannot choose either. The demo token path
is limited to demo rooms. A successful connection sets a separate HTTP-only
joined marker to avoid replaying the opening on refresh. This stage leaves the
agent, canonical transcript persistence, visual evidence writes, and researcher
evidence reads unchanged. Stage 2B.3 must gate preemptive LiveKit generation
until canonical participant transcript persistence has completed.

HTTP acceptance against the linked Qalvi project passed with temporary study
fixtures that were deleted afterward. No WebRTC agent conversation or canonical
transcript write was claimed as validated in Stage 2B.2.

Use only a server-side `sb_secret_` key for elevated gateway access and reject
legacy JWTs under that variable. Do not attach researcher cookies to this client.
Disabling the legacy API keys is a separate dashboard operation after all
application paths have passed with publishable/secret keys. Cancellation stops
new application access, but existing LiveKit connections and unexpired issued
tokens still need terminal-session removal in Stage 2B.4.

## 2026-09-25 — M4 Stage 2B.3 canonical transcript gate

The installed LiveKit Agents SDK starts tentative LLM work before the awaited
voice turn callback unless preemptive generation is disabled. Disable it only
for persisted real rooms, then make the completed-turn callback await the
Stage 2B.1 append RPC before calling the conductor or allowing a reply. Typed
streams have their own callback and follow the same write-before-reply rule.
The browser's transport `sendText` completion is not durable success: a real
typed draft clears only after a same-room agent acknowledgement of the database
message. A stable client event ID spans retries because the SDK allocates a new
text stream ID for every retry. Its value is an idempotency key, never a tenant
or authorization claim.

Use an isolated agent-only `sb_secret_` client with no legacy JWT fallback.
Trusted LiveKit room and participant identity select the saved conversation;
the database RPC claims a fenced writer generation and owns sequence allocation.
Voice, typed, and assistant keys have distinct namespaces. Retry uncertain
acknowledgements with the same event key and full payload, never a new one.
Pause on persistent write failure rather than generate an unsaved response.
Persist SDK-forwarded assistant text with its interruption flag, not raw LLM
completion. This cannot prove device-level audio delivery. No microphone audio
is recorded. No distributed exactly-once claim is made.

Linked-project database acceptance passed with temporary fixtures that were
deleted. Controlled Cloud acceptance on 2026-09-25 then used a real LiveKit
WebRTC room and synthesized speech on its microphone track. One final voice
turn yielded one saved participant message; the assistant opening and replies,
plus a typed turn, persisted in one ordered conversation. Agent timing logs
placed the database acknowledgement before the corresponding LLM chat call
for voice and text. A typed same-key retry added no row. Separate linked-project
failure injection confirmed that a failed append pauses without LLM advancement
and that a lost-acknowledgement retry returns the existing message. Cancellation
ejection, replacement-agent history reconstruction, visual evidence, and
researcher live reads remain outside Stage 2B.3.

## 2026-09-27 — M4 Stage 2B.4A recovery foundation

Mark new canonical voice/text participant messages with protocol version 1.
After canonical database acknowledgement, classify the turn, advance the
conductor, and durably record one immutable versioned control decision keyed to
that exact message. Only then may the agent generate a reply. A missing control
record therefore identifies a turn for which reply generation must not have
started. Same-decision retry is idempotent; conflicting retry is rejected.
Legacy unmarked turns remain explicit and are not treated as replay-safe.

A service-only database function resolves a hashed, valid resume capability to
one bounded sequence-ordered transcript page. The participant route exposes
only whitelisted message fields and recovery flags, never control metadata or
tenant IDs. Terminal conversations may be read with an unexpired resume cookie
but cannot obtain writable LiveKit tokens. Browser final messages come from
canonical rows; LiveKit captions are provisional. An uncertain typed draft is
tab-scoped, retains its event ID and payload, and is never resent automatically.
The browser joined marker no longer decides whether an opening is fresh; the
agent uses its database-claimed writer generation. The token's resume hint is
derived from durable state for compatibility, but does not override the writer.
The replay module is intentionally not
wired to replacement Cloud worker startup. That, generation takeover,
heartbeat/lease cleanup, cancellation ejection and human-device acceptance
remain Stage 2B.4B.

Stage 2B.4A linked migration and type generation are complete, but live browser
acceptance remains open. The controlled browser test reached consent and a
server-derived participant room. LiveKit reported automatic dispatch, while
the deployed worker did not join, including after a restart and a fresh
deployment. Do not infer voice/text recovery acceptance from the local tests.
The consent POST origin check accepts an opaque `Origin` only when browser-owned
Fetch Metadata proves a same-origin document navigation; cross-site and missing
metadata remain denied. This preserves the invitation page's no-referrer policy.

## 2026-09-29 — LiveKit multi-profile routing foundation (unaccepted)

Keep the Qalvi conversation and canonical evidence independent of any LiveKit
project. Persist only a profile alias, room and generation on the conversation;
the server keeps each project's URL/key/secret together in an ordered profile.
The old unnamed single-project setup remains compatible when profile routing is
not configured. Multi-project mode requires a separately deployed named worker
in each LiveKit project and uses server-side explicit dispatch. A bounded job
assignment wait distinguishes PENDING from a worker with an ID. A service-only
database lease and compare-and-swap rotation permit failover only before a
writer/evidence exists. Quota, timeout and provider availability can select the
next project; authorization, schema and app failures cannot. Browser 202 token
responses mean continue waiting/retry, never resend a participant message.
Two distinct failed WebRTC connect attempts can rotate a still-pending session;
the database deduplicates reports by event ID and refuses reports after a writer
or evidence exists. The participant cannot choose a profile or room.
Configuration fails closed once `LIVEKIT_PROFILE_IDS` is present: incomplete
profiles, duplicate priorities, missing agent names, and unknown saved aliases
cannot use the legacy unnamed project. Only an unset list permits legacy mode.
Browser failure reports are generation-fenced, idempotent, limited to the
cookie-scoped session, and cannot set global provider health. Each enabled
profile gets one assignment attempt per routing cycle. For N profiles, at most
N-1 pre-interview rotations occur; the default assignment-wait component is
at most N x 45 seconds, plus provider setup/retry overhead. The browser has a
10-minute preparation deadline, but there is no persisted aggregate deadline.
Mid-interview cross-project recovery requires Stage 2B.4B reconstruction and
is intentionally not implemented. Local tests are not live backup acceptance.

## 2026-10-07 — Real refresh closes the SDK session unless explicitly preserved

The named primary worker successfully handled the one authorized fresh
participant session. No primary failure occurred, so failover was not inferred
or forced after writer ownership and canonical evidence existed. Voice and text
each showed database message acknowledgement, control acknowledgement, then
reply-model invocation. Browser refresh reconstructed seven canonical rows,
and saved control replay matched its hash without running the classifier.

Runtime logs then proved `CLIENT_INITIATED` refresh invoked the SDK's default
immediate agent-session closure. The agent participant remained visible, but
an explicit typed retry no longer reached a live input handler. Its draft stayed
locked and preserved, and no new or duplicate evidence was created. Override
that SDK option only for real sessions and retain the existing worker for a
bounded 120-second grace owned by the saved participant identity. Expiry marks
the conversation interrupted and shuts down the job. No replacement worker,
classifier replay, dispatch redesign or automatic resend is added.

The user declined an additional fresh failover session. Stage 2B.4A remains
unaccepted; the correction and backup failover both require live retest before
commit or closure. Stage 2B.4B remains deferred.

The same review found Cloud jobs supply `enable_recording=True`. The installed
SDK inherits that flag when `AgentSession.start(record=...)` is omitted and
enables its audio recorder. Explicitly set `record=False`: participant consent
permits the canonical research transcript, not Cloud audio/session recordings.
This corrective source is not claimed as live verified or deployed. Both
workers must receive the corrected source before the next live acceptance.

Temporary study deletion failed with `23001`: the control immutability trigger
also rejects the canonical message's foreign-key delete cascade. A follow-up
local migration allows a control delete only after its canonical parent is
absent. Direct deletes/updates remain forbidden, and grants/RLS are unchanged.
The new migration is not applied remotely. The temporary study/workspace rows
are retained, its session is cancelled and capabilities revoked, and the
temporary Auth account is removed. Apply the reviewed correction before
retrying fixture cleanup. Retained study: `4a46e1bb-6ce2-4cf0-9d9f-f0b4f871740b`;
workspace: `ba6ed154-b901-4389-b6ed-4102c27f7cfc`.

## 2026-10-07 — Corrected same-worker recovery passes; failover still open

Applied only forward migration `20261007000100_control_cascade_cleanup.sql`.
The linked schema is current. Direct control deletion remains forbidden;
authorized whole-study cascade removed the previously cancelled fixture while
unrelated message IDs remained unchanged. RLS and service-only RPC grants remain.

Corrected production sources deployed to the existing primary (`UUEPp5yezJfq`)
and backup (`3QzkQUTG44KT`); neither Cloud agent resource was replaced.
Primary session logs confirm `close_on_disconnect=false`, 120-second grace,
and `recording_enabled=False`. The first fresh corrective session showed a
second lifecycle failure: LiveKit removed the room about 25 seconds after the
last standard participant left. An agent participant does not prevent that
provider departure timeout. Specify 150 seconds at named-room creation so
the application's 120-second grace can finish first. Do not extend grace
indefinitely or introduce replacement-worker logic.

The second fresh session retained participant `17127416-5eba-4025-9f37-2d5616fc70df`,
conversation `fc516c6c-56af-4622-903c-8f2ebda54bce`, room `RM_ag9kc2SpiJEc`,
transport generation 1, writer generation 1, and job `AJ_28AoLBjJvzWe` across
refresh. Runtime showed message ACK, control ACK, then model invocation for
voice, normal text and post-refresh draft retry. Three completed SDK voice
items had distinct content/event IDs; no interim captions were treated as
canonical rows. Eleven canonical rows reconstructed in database sequence;
five saved controls replayed without classification. The seeded uncertain
tab draft retained its stable event ID, was not automatically resent, and an
explicit retry created one row, cleared the draft and received an assistant
reply. Opening was not replayed. The transcript equality harness initially
compared incompatible Unicode JSON encodings; correcting that check verified
the existing UI rather than prompting a product change.

Both available fresh sessions were used for recovery diagnosis/retest.
Controlled routing failover was not run, and normal primary configuration was
never replaced with a failure target. Stage 2B.4A remains OPEN, not accepted or
committed. Human microphone/device acceptance, replacement-worker recovery,
visual persistence and cancellation ejection remain deferred to their approved
later stages. Application cancellation denies new tokens and canonical writes;
it is not claimed to eject an already-connected LiveKit participant.

Final linked checks rejected six anonymous/authenticated privileged RPC and
raw-message operations, stale writer and wrong-profile claims, forged resume
cookies on state/token routes, and canonical writes after cancellation.
Cancelled refresh remained read-only. Node tests passed 106/106, Python
108/108; TypeScript, lint, production build and diff checks passed. Exact-value
scans of source/client assets against local app and agent credentials found no
matches. Both temporary rooms/dispatches, the disposable study/workspace,
capability rows, canonical fixture rows and Auth user were removed through
scoped cleanup; unrelated evidence was unchanged. Deployment resources remain.

## 2026-10-08 — Stage 2B.4A closed: live primary-to-backup failover accepted

Acceptance A (same-worker recovery, 2026-10-07) stands and was not repeated.
Acceptance B forced a real primary assignment failure without touching either
LiveKit deployment. For one Next.js server run only, the primary profile's agent
target was overridden in the server's process environment to
`qalvi-interview-primary-failover-probe`. `.env.local`, priorities, enabled
flags and deployment pins were unchanged, and no deployment pin was set. The
override was removed by restarting without it.

One fresh invitation and consent produced participant
`6a1d8757-aed1-43f3-a43f-81f20b4d6ebd` and conversation
`d627fa9f-22a8-4249-b88d-329f6eceaf7e`.

- Primary: room `qalvi-real-b2e5cfd7-095c-499b-ac53-0a38685dd336` (`RM_tj5SUXbWT766`)
  received named dispatch `AD_vYprWKextx5a` to the probe name. LiveKit never
  created a job for it, so the router raised `assignment_timeout` 46.5 s after
  the dispatch and rotated at 01:59:07.890 UTC. The browser's first token request
  returned 202 after 53.1 s. No participant ever joined this room.
- Backup: room `qalvi-real-03ac1e94-821a-439c-a215-cb86663f0f46` (`RM_GJpsPU2XeQ6D`)
  received dispatch `AD_2fnBiGqccNAe` to `qalvi-interview-backup-1`. The sleeping
  worker cold-started, registered as `CAW_64t9aEG55QEJ` under that agent name, and
  ran job `AJ_T2dxm5XGbgGN` 10.3 s after the dispatch. The second token request
  returned 200 after 16.6 s.
- Conversation after rotation: `livekit_profile_id=backup_1`, `transport_generation=2`,
  `previous_livekit_profile_id=primary`, `transport_failure_reason=assignment_timeout`,
  `transport_failed_profiles={primary}`, same participant and conversation,
  `writer_generation=1`.
- The backup worker's successful fenced claim proves its `QALVI_LIVEKIT_PROFILE_ID`
  is `backup_1`: the claim requires that value whenever `LIVEKIT_AGENT_NAME` is set,
  and both secrets exist. It logged `recording_enabled=False` although the Cloud
  job requested recording. It wrote the opening (sequence 0), a version-1 typed
  participant turn (sequence 1) with message ACK, then control ACK, then reply
  generation, and the reply (sequence 2). There was one control record, the draft
  cleared after acknowledgement, and the greeting was not replayed.
- Live probes: the old primary room maps to no conversation; a stale generation-1
  rotation and a rotation of the active session both returned "transport rotation
  is unsafe or stale"; a stale generation-1 lease was not granted; state was
  unchanged afterwards.

The pre-registered contingency, a probe job marked FAILED before assignment
returning 500, did not occur, so the router was not changed. Treating such a
FAILED job as a failover-eligible provider failure remains a documented open
question, not a change.

LiveKit Cloud attached an automatic unnamed dispatch to each server-created room.
It stayed jobless because every worker in both projects is named. Deploying an
unnamed worker into a profile project is therefore not allowed.

The disposable researcher, workspace, study, invitation, conversation, canonical
rows and both rooms were removed through scoped cleanup, and all ten checked
table counts returned to their baseline. Both deployments remained `UUEPp5yezJfq`
and `3QzkQUTG44KT`.

Migration verification: remote history lists the same seven versions as the
repository. `supabase migration fetch` into a scratch directory returned SQL
identical to every local file apart from blank lines between statements, which
the history table does not store. `20261007000100` is byte-identical.

Stage 2B.4A is CLOSED. Stage 2B.4B (replacement worker after worker loss,
post-grace orphan rooms, natural completion status, the `in_progress` shutdown
boundary, cancellation ejection) has not started.

## 2026-10-08 — Stage 2B.4B: writer lease, replacement recovery and interview endings

Stage 2B.4A was integrated into master by fast-forward (`136b214..1357341`, no
force, no history rewrite; the corrupt `.git/ORIG_HEAD` was avoided by updating
refs with push and fetch rather than repaired). Stage 2B.4B is developed on
`stage-2b4b-lifecycle`.

Decision: liveness is a server-clock lease, fencing stays the generation. A
worker claims a 30-second lease for its LiveKit job and renews it every 10
seconds. Another job can never take a live lease. A lapsed or released lease lets
the server reserve one takeover per 90-second window (three consecutive attempts
at most); the reservation itself advances the generation, so a lapsed writer that
wakes up cannot write between the decision and the replacement's claim. Older
deployed workers keep using the previous claim while no lease is held and can
never take a live one.

Decision: a replacement continues only from durable state. It replays saved
controls (no reclassification) and rebuilds model context from canonical rows.
The control record is the gate before any reply, so a saved participant turn
without a control is classified and answered once; a turn with a control may have
been answered aloud and is never regenerated. The greeting gets the same rule
through a durable opening marker written before it is generated. Damaged history
ends the interview as `failed` (`recovery_integrity`) rather than improvising.

Decision: one idempotent terminal authority. `end_interview_conversation` sets
`ended_at`, an end reason, clears the lease and enqueues room ejection in one
transaction. Participant end and natural close are `completed`; researcher
cancellation (and ending a never-started interview) is `cancelled`. Ejection runs
through a durable outbox with backoff (abandoned after ten attempts, retained for
review) using each room's own project credentials, and independently through the
worker's own heartbeat. A scheduler must call `/api/internal/lifecycle-outbox`
with `QALVI_INTERNAL_TASK_SECRET` in deployment; requests that end an interview
also drain it at once. LiveKit tokens cannot be revoked; the 5-minute TTL bounds
an already-issued token, and no writer can be claimed for a terminal session.

Live acceptance found two defects, both fixed before the recorded runs: the
heartbeat answered a server-recorded ending with "stale" (the ending had cleared
the job ID), so the worker never ejected on its own; forward migration
`20261009000100` reports the terminal status to the current generation. And the
LiveKit server SDK's region failover let one API call outlast the assignment
window while a token request held its preparation lease; every LiveKit call is
now bounded and a timeout is a failover-eligible provider failure. A worker that
returns from its entrypoint keeps its job connected in LiveKit Agents 1.8, so every
early exit now shuts the job down.

Automated live acceptance on primary `6UsqFczaqMPv` (backup `8su99bUN5iL3`
deployed identically), typed turns in headless Chrome, crash boundaries created
through the service role: conversation `10f6b13d-fc40-42cd-b7b4-f8e8fb24af78`
(participant `a51b79e9-5967-4018-898a-892d2be7ecd1`) passed 18/18 through writer
generation 7 with 8 canonical rows and 4 controls, then researcher cancellation
ejected its room within a second. `157ad0b5-cfb4-44de-aacf-2e33443e91ac` passed
participant end. `914c6a6e-c1a0-43ae-a08b-2ef7b907684b` passed worker-side ejection
in 9.5 s with the outbox drained afterwards by the scheduler route. A session
left past its grace was `interrupted` with the lease released and resumed by a
replacement without re-greeting. The disposable researcher, workspace, study,
conversations and rooms were removed; all checked table counts returned to
baseline.

Not done: human microphone/device acceptance, a voice-turn replacement, a
replacement inside the backup project, and the browser UI for the new states
(Codex; contract in ARCHITECTURE). Stage 2B.4B is OPEN.

## 2026-10-09 — Stage 2B.4B participant lifecycle UI

Use the accepted backend at `f522ea1` on a separate `stage-2b4b-ui` branch.
No agent, migration, privileged client, API, provider or dispatch changes.
Room connectivity alone does not mean Qalvi is ready: bounded recovery polls
the existing endpoint, and waits for an actual agent. A new agent replaces the
current interviewer, including a brief overlap with the old participant.
`resumed` and `reply_uncertain` never expect a greeting or manufacture a delayed
reply. Canonical assistant rows can settle a pending turn when transport captions
were missed. Typed evidence remains acknowledged through the existing stable ID
path; nothing is automatically resent.

Participant end is confirmed in an accessible native dialog, single-flight and
server-authoritative. Distinct terminal/end-reason and expiry states retain loaded
evidence and stop microphone/submission/recovery loops. Ending or expiry clears
drafts; temporary failures preserve them. Escape focus restoration was corrected
after a headless Chrome check; successful ending focuses the terminal notice.

The researcher UI has no real conversation action yet; sample IDs cannot safely
be sent to researcher cancellation. Defer that surface and keep the existing
authenticated cancellation API. Stage 2B.4B remains OPEN pending real human/device,
voice-replacement and backup-project replacement checks. No Stage 2B.5 work.

UI validation: 148 Node tests passed, including database/RLS tests. Headless
Chrome passed 26 lifecycle checks against the real React components with mocked
transport/API events, plus 10 production-page smoke assertions for the demo and
visual gallery. All four widths (320, 390, 768 and 1440px) had no overflow.
These checks do not establish real Cloud voice or human microphone acceptance.

Final TypeScript and production build passed. Credential scanning covered 183
source/client files with zero exact-value matches; git diff --check was clean.
Final full-project lint passed without errors or warnings.

Handoff (2026-10-09): the participant lifecycle UI is accepted as implementation-
complete and ready for final live acceptance. The checkpoint stays on
stage-2b4b-ui; Stage 2B.4B remains OPEN and master is not merged. Focused
interview, recovery and visual regressions passed again: 56/56. No application
code changed after the full TypeScript, lint and production-build validation.

## 2026-10-09 — Stage 2B.4B integration and final live acceptance

Integrate on `stage-2b4b-integration` from `1b8a575` (UI on the `f522ea1` backend);
neither source branch was rewritten. The UI matches the backend contract, so no
lifecycle semantics changed.

Decision: restore the public demo by named dispatch instead of deploying an unnamed
worker. 2B.4A forbids unnamed workers in profile projects (they would join every
interview room), which left the demo, still on automatic dispatch, without an
interviewer. The demo token route now requests the named worker of the profile
whose URL matches the legacy project, once per room. Real interviews are unaffected.

Decision: Stage 2B.4B stays OPEN. Live real-browser acceptance passed for the
lifecycle, cancellation, expiry, damaged history and a backup-project replacement,
but human microphone acceptance and a spoken-turn replacement need a person, and
the outbox scheduler needs a deployment that does not exist. No scheduler was
configured against a local machine and called deployment.

Recorded observations: one failed-path run in seven where the browser never
requested recovery after the fenced worker left; one cold-start backup session that
never joined although a job was assigned; and the inline drain serving the oldest
five rows first, so an ending's own row can wait behind a backlog (the worker
heartbeat still ejects its room). Harness assertions corrected during the run: the
mid-session microphone failure uses its own wording, ejection is awaited rather
than sampled, and LiveKit does not list a finished dispatch.

## 2026-10-10 — Stage 2B.4B first human microphone session

The first human session (`c6a9f3e9-24a4-4789-8265-548caa12877b`) does not pass
human-device acceptance. Voice capture, transcription, control-before-reply
ordering, spoken replies and the ending all worked, but the participant's microphone
captured Qalvi's playback and five echoes of Qalvi's speech were saved as
participant messages and classified. Raw evidence attributed to the wrong speaker
is an evidence-integrity failure, so this is a blocker, not a tuning note. No
refresh happened and the crash injector's window had expired, so neither refresh
nor spoken-turn replacement was tested.

Proposed, not implemented (needs approval because it changes the voice pipeline or
adds a dependency): enable LiveKit Cloud enhanced noise cancellation on the agent's
audio input, and/or hold participant audio while Qalvi is speaking unless the
participant clearly interrupts. A repeat session should use headphones first to
separate device echo from a pipeline defect. Stage 2B.4B remains OPEN.

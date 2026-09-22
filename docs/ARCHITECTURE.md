# Qalvi Architecture

## Current Technology Stack

Frontend and server:
- Next.js
- React
- TypeScript
- Tailwind CSS

Database/authentication/storage:
- Supabase (planned; not connected in M2.5)

Realtime voice:
- LiveKit

Initial AI provider:
- Groq

Speech-to-text:
- Groq Whisper initially

Interview LLM:
- Groq-hosted language model initially

Text-to-speech:
- Groq-supported speech model initially

Charts:
- Recharts (planned; not installed in M2.5)

Package manager:
- npm

## High-Level Architecture

Participant Browser
    ↓
Next.js Interview UI
    ↓
LiveKit Voice Session OR Text Input
    ↓
Speech-to-Text if voice
    ↓
Qalvi Interview Engine
    ↓
LLM
    ↓
Structured InterviewTurn response
    ↓
Possible outputs:
    - spoken response
    - text response
    - visual action
    - finding
    - objective state update
    ↓
React renders UI
    ↓
Supabase stores evidence

## Important Principle

AI reasons.

Application code calculates.

React visualizes.

Database remembers.

The AI must not generate and execute arbitrary JavaScript or Python during participant interviews.

## AI Provider Abstraction

Do not tightly couple the entire application to Groq.

Eventually use an interface conceptually similar to:

interface AIProvider {
  generateInterviewTurn(...): Promise<InterviewTurn>
}

Potential future providers:

- Groq
- OpenAI
- Anthropic
- Gemini
- OpenRouter

Only Groq needs to work initially.

## Security

All sensitive API keys remain server-side.

Never expose:

- GROQ_API_KEY
- SUPABASE_SERVICE_ROLE_KEY
- LIVEKIT_API_SECRET

to the browser.

Browser clients may only receive credentials/tokens specifically intended for client use.

## Reusable Visual Components

Initial visual actions may include:

- bar chart
- line chart
- pie chart
- comparison cards
- slider
- multiple choice
- scale
- image
- text/concept card

Visuals are predefined React components.

The LLM provides structured configuration/data.

The LLM does not write frontend code.

## Deterministic Calculations

Financial calculations, pricing calculations and similar numerical logic must use deterministic application functions rather than relying on the LLM for arithmetic.

Example:

calculateRevenueParticipation(...)

The resulting values may then be passed into visualization components.

## Voice Architecture

LiveKit is the realtime transport/orchestration layer.

The participant may:
- speak
- type
- switch between voice and text
- see the live transcript
- hear the AI response
- eventually interrupt the AI naturally

Voice and text must feed the same interview-state engine.

No camera is required.

## Interview State

The interview engine, not the UI, owns the research state.

The system must track:
- objectives completed
- objectives remaining
- participant context
- findings
- concepts shown
- visual interactions
- objections
- commitment signals
- source evidence
- interview completion state

The AI has conversational freedom, but the surrounding application constrains the research process.

## M2.5 application surfaces

`src/app/(research)/layout.tsx` owns the researcher shell. The route group does not appear in URLs. Participant routes live outside this layout and never inherit the sidebar.

| Route | Current behavior |
| --- | --- |
| `/` | Redirect to `/dashboard` |
| `/dashboard` | Research home, sample counts, studies, templates |
| `/studies` | Searchable/filterable sample library |
| `/studies/new` | Unsaved local research-brief preview |
| `/studies/[studyId]` | Sample goal, interviews, counts, findings |
| `/studies/[studyId]/interviews` | Sample original messages, search/speaker filter |
| `/studies/[studyId]/participants` | Sample participants linked to conversations |
| `/studies/[studyId]/findings` | Hand-authored findings with source-message links |
| `/studies/[studyId]/settings` | Read-only details and evidence policy |
| `/interview/[studyId]` | Sample invitation with explicit live-demo limitations |
| `/interview/demo` | Existing validated LiveKit voice/text flow |

Unknown study IDs return a not-found state. Static `/studies/new` and `/interview/demo` take precedence over dynamic routes. Dynamic params are awaited using the installed Next.js conventions.

### Components and ownership

- `src/components/ui/primitives.tsx`: buttons/links, cards, badges, headings, empty states, decorative Qalvi orb.
- `src/components/research/`: shell, navigation, dashboard, study cards/library/workspace, clipboard feedback, evidence browser, local brief preview.
- `src/lib/research/mock-data.ts`: typed Study, Participant, Conversation, Message, Finding fixtures. Counts derive from the fixtures. No actual participant data or secrets.
- `src/app/(research)/research.css`: responsive styles scoped to researcher and invitation surfaces. Existing live interview tokens and logic remain unchanged.

Server pages/layouts resolve mock studies; client components own search, filters, clipboard feedback, and unsaved form state. No new runtime dependencies. Fonts stay local.

### Evidence model

`Study → Participant → Conversation → Raw Evidence → Derived Findings`

Participants reference studies. Conversations reference study and participant IDs. Messages are original evidence identified within a conversation. Findings reference explicit conversation/message IDs. Source links select a conversation and target the supporting message. Search/filtering changes the view, never the source.

Fixtures are illustrative excerpts, not persisted live interviews. No pipeline connects the LiveKit demo to researcher fixtures. Persistence, study-specific agent configuration, real creation, access control, and AI findings remain future work.

## M3 interactive visuals

`src/components/interview/visuals/display.ts` defines the `DisplayAction` union (`comparison_cards`, `bar_chart`, `slider`, `multiple_choice`), the `VisualResponse` union, `parseDisplayAction` (runtime validation at the browser boundary), and `describeResponse` (the plain-language summary of an answer). Each type maps to one component under `visuals/`; `VisualStage` switches on `action.type`. There is no registry, plugin system, or schema engine.

Transport, within the existing M2 session:

| Direction | Channel | Content |
| --- | --- | --- |
| Agent → browser | text stream, topic `qalvi.display` | JSON `DisplayAction`; invalid payloads are dropped |
| Browser → agent | text stream, topic `lk.chat` (same as typed input) | `[On screen] <summary>`, for example `[On screen] Chose "A mix of both"` |

`agent/visuals.py` holds the demo plan: predefined steps with a topic key, purpose, and priority. `agent/signals.py` asks the model for a structured reading of each participant turn. `agent/conductor.py` combines signals, plan, and the optional `agent/clock.py` time budget into a decision (show, clear, continue, shorten, close) and a one-reply note. `agent/presence.py` holds the inactivity policy. `Interviewer.present()` is the only seam; `on_user_turn_completed` (speech) and the text-input callback (typed messages and on-screen answers) both call it. A `null` payload on `qalvi.display` clears the screen. The LLM never chooses or authors display actions. `/interview/demo/visuals` renders the four visuals from local fixtures without a session.

Answers are recorded in the session transcript with `source: "visual"`; storing them as durable evidence is Milestone 4.

### Coverage strength

Coverage is not a yes or no. The classifier reports `covered` (answered fully enough that asking again in any form adds nothing) and `partial` (touched in words but left vague, approximate, or one-sided) separately. Only `covered` retires a planned step. A partially answered topic stays in the plan, because a visual can still do what words did not: compare alternatives, quantify something, expose a tradeoff, or make a vague answer concrete. `VISUAL_VALUE` in `agent/visuals.py` names that value per visual type, and the conductor passes it to the reply model so the visual arrives as a way to sharpen what was said, not as the same question repeated.

The classifier also reports `ambiguous`. When it is set, the turn records no coverage at all and no visual is offered, so Qalvi never turns a guess about garbled or unclear wording into research evidence.

### Active visual lifecycle

`Conductor.visual_state()` is the authoritative record of what the participant can see, from the moment a display is emitted until it is answered, cleared, or replaced. It carries the participant-facing prompt, the visual's kind in plain words, its purpose, and whether it is still waiting for an answer. Every reply note carries that state, except on the turn a visual is introduced, where its own guidance says more. So Qalvi can explain the thing currently on screen when asked what it is for, and cannot claim nothing is there while one is rendered and waiting.

Clearing is symmetrical. Whenever the conductor stops tracking a visual, including a confirmed one, it also clears the participant's screen, so the two views never disagree. A visual already on screen is explained rather than silently swapped out.

Because a participant deciding about a visual is taking part in the interview, `presence.check_in_allowed()` blocks an unprompted check-in while one is pending, and the clock does not open an absence exclusion. Without that guard, one participant turn could produce the reply plus two inactivity check-ins, all restating the same question.

### Plain speech

`agent/speech.py` is the last check before the voice and the transcript. `SpeechFilter` is applied in `Interviewer.llm_node`, which sits upstream of both synthesis and text forwarding, so one pass covers speech, the transcript, and the stored chat item. It removes markdown emphasis, code marks, headings, bullets, link targets, HTML entities, and internal markers such as `[On screen]` read back from a note. It cleans at whitespace boundaries, holding back only the last partial word, so synthesis still starts on the first few words. It only strips presentation syntax; it never rewrites what Qalvi said.

### Tool awareness

The interviewer knows what it can put on screen. `Conductor.available_visuals()` names the unused visual types in plain words (`VISUAL_NAME`), and the `visuals` intent covers a participant asking about or asking for one. The reply then either points at what is already on screen, brings up a relevant unused visual (explicit interest outranks a hold or an earlier set-aside), or says truthfully what can be shown and why nothing is going up now. Qalvi never claims it has no visuals when it has them, never names the schema or transport, and does not launch one during wrap-up just to demonstrate the feature.

### Failure degradation

`agent/failures.py` classifies every session error into one kind: signaling (room transport), `stt`, `llm`, `tts`, `tts_rate_limit`, or unknown. A speech-synthesis failure costs Qalvi's voice, not the interview, so it is never handled or reported as a lost connection.

On the first unrecoverable TTS failure the agent calls `session.output.set_audio_enabled(False)` and publishes `qalvi.voice: "unavailable"`. LiveKit then skips synthesis for every later turn (`perform_tts_inference` is guarded by `audio_output is not None`) while text forwarding continues, so assistant replies still reach the transcript and the participant may keep speaking or typing. Without this, LiveKit closes the whole `AgentSession` after `max_unrecoverable_errors` (3) consecutive failures.

The browser reads `qalvi.voice` in the same place as the agent state, keeps `connection` at `connected`, and shows a calm text notice. Connection loss stays the separate concern of `sessionHealth`. Voice does not return within a session; a new interview starts with voice enabled again.

The deterministic sequence is gated to `qalvi-demo-*` rooms. Future real study
rooms do not inherit it; study-specific triggers remain deferred. Visual action
IDs are unique within a session. Replayed IDs are ignored, and successful sends
lock only the action they answer, even if another visual arrives during the send.

### Participant connection recovery and composer

The existing LiveKit hook owns connecting, connected, reconnecting, disconnected,
and failed states. Both signaling-only and full reconnection suppress agent
activity labels and submissions until connected. Temporary recovery retains the
transcript, stable segment IDs, visual state, and composer draft. Terminal failure
keeps evidence visible and offers an explicit rejoin with the same room name and
participant identity. It does not create another networking layer or restore an
agent conversation that has already ended. Old visuals become reference-only
after terminal failure, preventing stale answers from reaching a restarted agent.

The unified composer grows from one line to a bounded scrollable input. Drafts
remain editable offline and during sends. Only a successful send clears the
unchanged submitted draft. Interrupted or timed-out sends are never automatically
retried: delivery can be uncertain, so the participant checks the conversation
before explicitly retrying. A LiveKit send completion is a transport result, not
an application-level acknowledgement from the interviewer. No persistence or M4
work is included.

The participant hook also observes LiveKit's current room/engine health once per
second and before sending. The small `sessionHealth.ts` adapter reads the same
`isClosed`/`verifyTransport()` checks used by the installed LiveKit 2.22 SDK; it
does not mutate or reconnect the engine. Recoverable transport faults remain
owned by LiveKit. A closed engine fails the UI immediately and uses public room
disconnect cleanup. Keep this internal read-only adapter covered when upgrading
LiveKit, since `Room.state` can briefly lag engine teardown.

An outstanding opening or participant turn has a 20-second no-progress notice.
New AI transcript progress clears/advances it; replayed segments cannot count as
a new response. Sends are never automatically repeated. Listening is shown only
with an active microphone; otherwise the connected idle state is Ready.

The agent requests its opening once, after session startup and participant
availability. SDK reconnect events never request another greeting. Explicit
rejoins carry `qalvi.resume` in the existing join token's participant attributes.
If a replacement agent job receives this marker, it reports
`qalvi.session.status=unavailable` instead of greeting without the old context.
Resumption requires the original agent session to survive; M3 has no durable
conversation restoration. Agent changes require deployment and live verification.

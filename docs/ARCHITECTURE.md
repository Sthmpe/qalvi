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

Fixtures are illustrative excerpts, not persisted live interviews. No pipeline connects the LiveKit demo to researcher fixtures. Persistence, study-specific agent configuration, real creation, access control, AI findings, and interactive visuals remain future work.

# Qalvi Architecture

## Current Technology Stack

Frontend and server:
- Next.js
- React
- TypeScript
- Tailwind CSS

Database/authentication/storage:
- Supabase

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
- Recharts

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

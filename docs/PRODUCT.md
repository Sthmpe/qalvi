# Qalvi Product Specification

## Product

Qalvi is an AI-powered conversation and research platform.

It helps founders, product teams, researchers, sales teams, agencies, and other teams conduct structured conversations with customers, prospects, users, and communities. The intended workflow is to define a study, share a participant link, and conduct adaptive conversations through an AI interviewer.

Qalvi is not a personal AI assistant or a recruitment/job-interview product. It is not intended to be merely a survey builder or generic chatbot.

Current use cases: customer discovery, PMF research, product research, concept testing, pricing research, customer feedback, sales discovery/client conversations, and conversational surveys/research.

## Evidence is the source of truth

**Raw interview evidence is the source of truth. AI-generated findings are derived from it and never replace it.**

The intended hierarchy is `Study → Participant → Conversation → Raw Evidence → Derived Findings`.

Original messages retain stable identities, speaker attribution, and ordering. Derived findings reference their supporting conversation and message IDs; they do not rewrite, replace, or hide original messages. Teams must be able to inspect, search, and filter original participant messages themselves, including evidence that challenges a finding.

M2.5 demonstrates these relationships with clearly labeled local fixtures, searchable sample transcript excerpts, and findings linked to source messages. No real interview evidence is persisted yet.

## Two distinct experiences

- Researcher/team workspace: define research questions, browse studies, inspect participant conversations, and review findings alongside their sources. M2.5 is a UI foundation, not an authenticated team workspace.
- Participant experience: a focused mobile-friendly voice/text conversation. No researcher sidebar, dashboard metrics, or camera. Switching input mode preserves one conversation.

M2.5 preserves the validated `/interview/demo` LiveKit flow. The dynamic participant invitation is explicitly a sample preview; sample study goals are not passed to the live demo agent.

The long-term product should help users turn customer conversations into evidence about whether a product, feature, price, business model or concept should be built.

## Core Product Idea

A researcher describes:

- what they are thinking of building
- who they want to interview
- assumptions they want to test
- hypotheses
- concepts or pricing they want to expose
- what evidence would change their decision

Qalvi helps create the research study.

Participants then receive a public interview link.

They can:

- speak naturally with the AI
- type instead
- switch between voice and text
- see a live transcript
- interact with charts
- compare concept cards
- use sliders
- answer multiple-choice questions where useful
- view images or product concepts
- respond to dynamic scenario simulations

The AI adapts its questions based on previous answers.

After interviews, Qalvi helps the researcher understand:

- recurring pain points
- current customer behaviour
- alternatives currently used
- objections
- willingness to pay
- trade-offs
- concept preferences
- commitment signals
- evidence supporting or contradicting hypotheses

All conclusions should remain traceable to original interview responses.

## Key Differentiator

Qalvi should not only interview people.

It should be able to TEST concepts interactively during the conversation.

Example:

A founder wants to test three pricing plans.

While speaking with the participant, Qalvi can display the three pricing cards.

The participant can tap one.

The AI then asks:

"Why did you choose that one?"

Another study may display:

- capped vs uncapped financing
- price sliders
- product screenshots
- charts
- delivery options
- feature bundles
- mock plans
- images
- scenarios

The visual interaction becomes part of the research evidence.

## Interaction Modes

Qalvi must support:

### Live Voice

Participant speaks naturally.

AI listens and responds verbally.

No camera is required.

The experience should eventually support interruptions and natural turn-taking.

### Text

Participant can type instead.

### Hybrid

Participant can switch between voice and text during the same interview.

The underlying interview state remains the same regardless of input mode.

## Initial Users

Primary initial users:

- startup founders
- solo founders
- early-stage teams
- product managers
- UX researchers
- innovation teams
- sales and client-facing teams
- agencies and community research teams

Founders validating ideas and researching Product-Market Fit remain a core audience, alongside teams studying customer, prospect, user, and community experiences.

## First Real Study

Korra will be the first real study used to dogfood Qalvi.

Korra is NOT part of Qalvi's architecture.

It is simply Study #1.

## Korra Study Example

The Korra study will test whether established private businesses would consider raising growth capital by temporarily sharing a percentage of verified business revenue with investors instead of taking conventional debt or permanently selling equity.

The study may test:

- current financing behaviour
- capital needs
- loan/equity alternatives
- capped vs uncapped participation
- acceptable revenue share
- duration
- impact on margins
- financial-record transparency
- willingness to connect bank/POS records
- willingness to join a pilot

This study demonstrates why Qalvi needs interactive charts, financial simulations and comparison cards.

## V0 Goal

The first complete vertical slice should allow:

Founder creates/configures a study.

Participant opens public link.

Participant chooses voice or text.

AI conducts adaptive interview.

AI can trigger one or more interactive visuals.

Participant responds.

Transcript and structured evidence are stored.

Founder can open the interview afterwards and review it.

## Explicitly Out of Scope for V0

Do NOT build yet:

- payments/subscriptions
- team membership, permissions, and workspace management (a visual researcher shell is included in M2.5)
- participant marketplace
- automatic participant recruitment
- video interviews
- complex analytics dashboards
- enterprise SSO
- mobile applications
- advanced exports
- hundreds of visualization types
- multi-model routing logic
- public API
- marketplace of research templates

These may come later.

## UI / UX Direction

Qalvi must feel premium, modern, calm, intelligent and highly polished.

The interface should NOT look like:
- a generic admin dashboard
- a survey form
- a basic ChatGPT clone
- an enterprise CRM
- a developer tool

The participant interview experience is the most important surface.

It should feel like entering a focused AI research session.

### Visual direction

Aim for:
- minimal layouts
- generous spacing
- excellent typography
- subtle depth
- smooth motion
- rounded but not overly playful components
- elegant cards
- sophisticated micro-interactions
- strong visual hierarchy
- premium SaaS quality
- excellent mobile responsiveness

Avoid:
- excessive gradients
- excessive glassmorphism
- neon AI aesthetics
- clutter
- too many borders
- dense dashboards
- unnecessary icons
- flashy animation that distracts from conversation

### Interview room

The interview room should feel immersive.

Important elements:
- prominent AI voice presence / animated voice orb
- clear participant speaking/listening state
- live transcript
- easy voice/text switching
- interactive visuals appearing naturally inside the conversation
- charts/cards/sliders should feel integrated, not embedded as external widgets
- subtle transitions when the AI introduces a visual
- clear indication when AI is listening, thinking or speaking
- no camera UI

The participant should feel like they are speaking with a skilled researcher, not filling a form.

### Researcher/team experience

The researcher workspace should remain clean and evidence-focused.

Prioritize:
- studies
- interviews
- findings
- evidence
- participant signals

Avoid overwhelming users with metrics that do not help research decisions.

### Design quality bar

Every screen should look launch-ready rather than like a developer prototype.

Desktop and mobile should both feel deliberately designed.

Accessibility, readability and performance take priority over decorative effects.
### M2.5 visual identity

Use charcoal `#25282D`, graphite `#4B4F58`, cool grey `#8B8F9A`, soft grey `#F3F4F6`, off-white `#FAF9F7`, indigo `#4F46E5`, and light indigo `#8B7DFF`. Body text uses graphite; cool grey is secondary/decorative. A glowing indigo orb is the signature Qalvi interviewer identity. Localize gradients to the orb.

Use local Geist fonts, generous spacing, subtle depth, restrained borders, and calm movement with reduced-motion support. The desktop researcher shell has a charcoal sidebar and off-white content canvas. Mobile uses compact workspace navigation, stacked content, and scrollable study tabs. Participant pages remain focused and separate.

### M2.5 scope boundary

Local mock studies, counts, participants, transcript excerpts, and hand-authored findings illustrate the product. The new-study screen previews an unsaved research brief only. Settings are read-only. No Supabase, authentication, billing, permissions, real study creation, AI findings generation, OpenRouter/model switching, recruitment/job interviews, or Milestone 3 interactive visuals.

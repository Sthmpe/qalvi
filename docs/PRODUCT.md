# Qalvi Product Specification

## Product

Qalvi is an AI-powered customer research and Product-Market Fit experimentation platform.

It allows founders, startups, product teams and researchers to create a study, share an interview link with participants, and let an AI researcher conduct adaptive qualitative interviews.

Qalvi is not intended to be merely a survey builder or generic chatbot.

The long-term product should help users turn customer conversations into evidence about whether a product, feature, price, business model or concept should be built.

## Core Product Idea

A founder describes:

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

After interviews, Qalvi helps the founder understand:

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

Initial focus is founders trying to validate an idea or reach Product-Market Fit.

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
- teams/workspaces
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

### Founder experience

Founder dashboard should remain clean and evidence-focused.

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
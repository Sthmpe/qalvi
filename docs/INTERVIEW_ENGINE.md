# Qalvi Interview Engine

## Purpose

The interview engine is the core product.

It prevents Qalvi from becoming a generic AI chatbot.

The AI has freedom to conduct a natural conversation, but must satisfy defined research objectives.

## Study

Every study contains:

- title
- research goal
- target participant
- founder hypothesis
- assumptions
- concept
- interview objectives
- optional concept assets
- optional interactive tests
- qualification rules
- commitment test
- desired duration

## Interview Objectives

Example generic objectives:

- participant_context
- current_behavior
- recent_real_example
- problem_severity
- current_alternatives
- concept_reaction
- objection
- tradeoff
- willingness_to_pay
- commitment

Not every study requires every objective.

## Behaviour Before Hypotheticals

Qalvi should prioritize questions about real previous behaviour.

Example:

Bad:
"Would you pay for this?"

Better:
"Tell me about the last time you paid for something to solve this problem."

Only after understanding current behaviour should Qalvi expose the concept.

## Neutral Research Behaviour

The AI interviewer must not sell the founder's idea.

If participant says:

"This sounds too expensive."

The AI must NOT say:

"But it could save you money."

Instead:

"What makes it feel too expensive?"

The interviewer should explore objections, not defend the product.

## Interview State

The engine should track:

- objectives completed
- objectives remaining
- findings
- participant profile
- concepts shown
- visual interactions
- objections
- commitments
- interview duration
- whether interview can finish

## Example Structured AI Response

{
  "message": "Let me show you what that looks like under three scenarios.",
  "objectiveId": "tradeoff",
  "objectiveCompleted": false,
  "findings": [],
  "display": {
    "type": "bar_chart",
    "payload": {}
  },
  "interviewComplete": false
}

## Evidence

AI-generated findings must retain references to the interview message(s) supporting them.

Never allow an unsupported AI summary to become the only research record.

Raw transcript is always preserved.

## Voice and Text

Voice and text feed into the same interview engine.

Voice:
audio → transcription → interview engine.

Text:
text → interview engine.

AI output can be displayed as text and optionally spoken using TTS.

## Interview Duration

Initial target:

approximately 7–12 minutes.

The engine should prioritize important objectives rather than force every interview to have the same number of questions.
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

The hierarchy is `Study → Participant → Conversation → Raw Evidence → Derived Findings`.

Raw interview evidence is the source of truth. Findings must not replace messages or turn interpretations into participant quotes. Researchers must eventually be able to inspect, search, and filter messages independently of a summary, including counter-evidence.

M2.5 demonstrates this with sample messages and explicit finding-to-message links, not generated agent findings. M4 Stage 1 defines durable guarantees in the database: immutable messages, on-screen answers stored as both a message and a structured response, and findings that must cite supporting messages (see ARCHITECTURE, M4 persistence foundation). Stage 2B.3 implements canonical voice/text and assistant transcript writes for real interview rooms. Browser reconstruction, visual evidence writes, and AI findings generation remain unimplemented; the researcher sample screens are unchanged.

M3 adds on-screen answers as evidence: a participant's tap, slider value, or selection becomes a participant message in the same transcript, marked as given on screen. The `display` field in the structured response above is realised as a `DisplayAction` with four types. In M3 application code decides whether and when a predefined visual appears; the LLM is told what is on screen and asked to respond neutrally, and it does not choose or author visuals.

## Conversational control (M3)

The research plan guides the interview. It does not control the human. Every participant turn passes through one seam in the agent (`Interviewer.present()`), which does three things:

1. The model reads the turn into a few structured signals (`agent/signals.py`): intent (continue, detour, question, concern, fatigue, time_left, stop, resume, skip, visuals, unclear), engagement (engaged, neutral, low), which planned topics are now sufficiently covered and which are only partly touched, whether the wording is too ambiguous to read as an answer, and whether a short follow-up would add anything. Any classifier failure degrades to neutral signals.
2. The conductor (`agent/conductor.py`) combines those signals with the plan and the optional time budget and decides: show a predefined visual, take one off the screen, continue without one, shorten the remaining path, or close.
3. The reply model receives a short note for that one reply. It reasons from the conversation plus that state. There are no phrase rules.

Behaviour this produces:

- A concern (relevance, confusion, repetition) is answered before anything else: acknowledge, explain the purpose in a sentence if useful, offer to rephrase or skip. An unanswered visual is taken off the screen. The concern is itself evidence; Qalvi never argues or advances past it.
- Fatigue, or asking how much remains, shortens the path to high-priority steps only and drops low-value visuals. Time questions are answered from real clock state, or "no fixed time limit" when there is no budget.
- A first stop request may be met once with a shorter path (one useful question left, and it is fine to finish now). A second stop closes. Nothing planned has to be completed.
- Two consecutive low-engagement turns switch visuals off for the rest of the interview.
- Topics answered well enough that asking again would add nothing are retired; their visuals are never shown and the reply model is told not to ask again.
- A topic touched only in words stays in the plan. A visual is a tool, not a step to tick off, so it may still be used to quantify something, compare alternatives, expose a tradeoff, reveal a preference, or make a vague answer concrete. The note names that value and tells the model to acknowledge what was said rather than repeat the question. A visual is never forced merely because it exists, and never launched during wrap-up to demonstrate the feature.
- Qalvi knows which visuals this interview can use. Asked about them, it says truthfully what it can bring up, in plain words rather than technical names, and never claims it has none. If a relevant unused visual remains and the participant shows interest, it may go up; explicit interest outranks a quiet spell or an earlier set-aside.
- Qalvi also knows what is on screen right now: its question, its kind in plain words, and whether it is waiting or already answered. That state reaches every reply, so "what is this for?" is answered about the actual visual. A visual already waiting is explained, not swapped out, and the screen is cleared whenever the conductor stops tracking one, so the two never disagree.
- A participant deciding about a visual is taking part, not absent. No check-in interrupts them, and the clock keeps counting.
- Replies are plain speech. Markdown, HTML entities, and internal markers are stripped before anything is spoken or written to the transcript.
- Ambiguous wording produces no evidence. Qalvi does not decide what the participant probably meant; it checks in briefly or reflects back only what was actually said.
- After an on-screen answer, the note says whether a follow-up is useful, sufficient, or for the model to judge. There is no mechanical "why".

### Goal anchoring

Follow the person conversationally, but follow the research strategically. Every per-turn note starts with the action chosen for the reply and ends with the research anchor: the study goal, the current objective, what has been learned, what is still unresolved, and the stage (opening, exploration, deeper understanding, narrowing, wrap-up). Every reply implicitly answers two questions: what does the participant need right now, and how does this move toward the goal without sounding robotic.

- Detours: a brief tangent gets a natural few words and a bridge back to the current objective. Several in a row get a kinder but more explicit reminder of what the conversation is trying to understand, and the next relevant question. Never shaming, never an abrupt cut.
- Participant questions: answered briefly and neutrally, then the interview resumes on the current objective. A question never replaces the interview.
- Concerns: handled first. The objective returns to the plan afterwards, verbal-only: Qalvi may return to it in a better way, skip it, or move on, but the visual the participant objected to is not shown again.
- Fatigue: compression, not loss of purpose. The note names the one or two highest-value unresolved areas and offers that shortened finish, with real timing state when a budget exists.
- Stop correction: if a stop was misread and the participant says so, the interview reopens from the current objective. A visual set aside by the misread comes back; a shortening caused by it is undone.
- Unclear input: a probably garbled turn learns nothing. No clock start, no coverage, no visual, no closing; Qalvi asks for a brief repeat.
- Progression: a follow-up needs a research reason (behaviour, motivation, pain point, alternative, tradeoff, assumption, ambiguity). After three on-topic turns on one objective without progress, the conductor moves to the next objective.

The decision principle is one of: acknowledge and probe, acknowledge and redirect, clarify, answer briefly then redirect, show a relevant visual, continue without a visual, skip a planned item, shorten the interview, move to the next objective, wrap up. The research objective remains the anchor unless the participant explicitly ends the interview.

### Time budget

A study may have no duration limit. When it does, `TimeBudget` (max active duration; focus at 30% remaining; closing at 10% remaining or at least 60 seconds; 90 seconds of absence grace) feeds the conductor as one input among the others. The clock starts on the first committed participant turn. Active time excludes disconnections, system failures, and silence beyond the grace period; ordinary pauses, typing, and listening all count. Phase is evaluated only at turn boundaries, so time never interrupts speech or typing: when the budget is reached, the current response is received and acknowledged, and that reply closes naturally. There is no participant-visible countdown. Defaults are configurable per study; the demo uses ten minutes.

### Inactivity

After genuine mutual idleness (Qalvi listening, participant silent) Qalvi may check in once after 60 seconds (120 in text mode, since typing is invisible), offer to continue, skip, or finish after another 60 seconds, and then stays quiet. It never speaks while the participant is speaking or while a reply is in progress.

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

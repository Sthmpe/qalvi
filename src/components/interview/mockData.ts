import type { ConceptOption } from "./types";

/**
 * Purely local, mocked content for Milestone 1.
 * Generic and study-agnostic — no Korra-specific language.
 * This will later be replaced by real interview-engine turns (Milestone 2/3).
 */

export const AI_GREETING =
  "Thanks for joining. I'd like to understand how you currently handle this today — nothing to prepare, just talk me through it.";

export const AI_FOLLOW_UP_QUESTION =
  "Got it, that's really useful. Can you walk me through the last time that actually happened?";

export const AI_CONCEPT_INTRO =
  "That's helpful context. Let me show you a few directions we're considering — tap the one that feels closest to what you'd want.";

export const AI_CONCEPT_FOLLOW_UP = "Interesting choice. What made that one stand out to you?";

export const MOCK_PARTICIPANT_REPLIES = [
  "Sure — right now it's mostly a manual process, we kind of piece it together as we go.",
  "It was maybe two weeks ago, we ended up scrambling a bit to pull the numbers together in time.",
];

export const CONCEPT_OPTIONS: ConceptOption[] = [
  {
    id: "plan-a",
    label: "Plan A",
    description: "Lower commitment, capped participation",
    interestScore: 42,
  },
  {
    id: "plan-b",
    label: "Plan B",
    description: "Balanced terms, moderate flexibility",
    interestScore: 78,
  },
  {
    id: "plan-c",
    label: "Plan C",
    description: "Higher flexibility, uncapped participation",
    interestScore: 55,
  },
];

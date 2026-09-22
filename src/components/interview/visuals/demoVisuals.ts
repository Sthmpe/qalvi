import type { DisplayAction } from "./display";

/** Illustrative content for the visuals preview. The live demo agent sends its own sequence. */
export const demoVisuals: DisplayAction[] = [
  {
    type: "comparison_cards",
    id: "demo-cards",
    prompt: "Which of these feels closest to how your week runs?",
    options: [
      { id: "planned", label: "Planned in advance", description: "Most of the week is mapped out before it starts." },
      { id: "shaped", label: "Shaped as it goes", description: "Priorities shift with whatever comes in." },
      { id: "mixed", label: "A mix of both", description: "A few fixed anchors, and the rest stays open." },
    ],
  },
  {
    type: "bar_chart",
    id: "demo-chart",
    prompt: "One way a working day can split. How does yours compare?",
    unit: "%",
    bars: [
      { id: "focus", label: "Focused work", value: 35 },
      { id: "meetings", label: "Meetings", value: 25 },
      { id: "messages", label: "Messages and coordination", value: 25 },
      { id: "other", label: "Everything else", value: 15 },
    ],
  },
  {
    type: "slider",
    id: "demo-slider",
    prompt: "Roughly how much of a typical day gets interrupted?",
    min: 0,
    max: 100,
    step: 5,
    initial: 30,
    unit: "%",
    minLabel: "Rarely",
    maxLabel: "Constantly",
  },
  {
    type: "multiple_choice",
    id: "demo-choice",
    prompt: "What usually causes the shift?",
    multiple: true,
    options: [
      { id: "clients", label: "Messages from clients or customers" },
      { id: "team", label: "Requests from the team" },
      { id: "urgent", label: "Something urgent breaks" },
      { id: "self", label: "Changing my own mind" },
    ],
  },
];

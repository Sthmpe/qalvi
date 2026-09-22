// Illustrative fixtures only. No data here comes from a real participant.
export type Study = {
  id: string;
  title: string;
  category: string;
  status: "Active" | "Draft" | "Completed";
  description: string;
  goal: string;
  audience: string;
  updated: string;
};
export type Participant = {
  id: string;
  studyId: string;
  name: string;
  role: string;
};
export type Message = {
  id: string;
  speaker: "participant" | "interviewer";
  text: string;
  time: string;
};
export type Conversation = {
  id: string;
  studyId: string;
  participantId: string;
  date: string;
  duration: string;
  mode: "Voice" | "Text";
  messages: Message[];
};
export type Finding = {
  id: string;
  studyId: string;
  title: string;
  description: string;
  sources: { conversationId: string; messageId: string }[];
};

export const studies: Study[] = [
  {
    id: "everyday-work",
    title: "Making space for focused work",
    category: "Customer discovery",
    status: "Active",
    description:
      "Understand how small teams protect their time and keep work moving.",
    goal: "Learn how small teams manage competing priorities, where their current tools fall short, and what a better working day would look like.",
    audience: "People leading teams of 2–20",
    updated: "21 Sep 2026",
  },
  {
    id: "pricing-confidence",
    title: "The value behind the price",
    category: "Pricing research",
    status: "Completed",
    description:
      "Explore what makes a team feel confident about a software purchase.",
    goal: "Understand how buyers assess value and justify a recurring software expense.",
    audience: "Small-business software buyers",
    updated: "19 Sep 2026",
  },
  {
    id: "first-impressions",
    title: "A simpler first five minutes",
    category: "Concept testing",
    status: "Draft",
    description:
      "Explore reactions to a more considered onboarding experience.",
    goal: "Learn which information new users need to feel ready to begin.",
    audience: "People trying a new product",
    updated: "18 Sep 2026",
  },
];
export const participants: Participant[] = [
  {
    id: "p01",
    studyId: "everyday-work",
    name: "Participant 01",
    role: "Product lead · team of 8",
  },
  {
    id: "p02",
    studyId: "everyday-work",
    name: "Participant 02",
    role: "Agency founder · team of 5",
  },
  {
    id: "p03",
    studyId: "everyday-work",
    name: "Participant 03",
    role: "Design lead · team of 12",
  },
  {
    id: "p04",
    studyId: "pricing-confidence",
    name: "Participant 04",
    role: "Operations lead · team of 15",
  },
];
export const conversations: Conversation[] = [
  {
    id: "c01",
    studyId: "everyday-work",
    participantId: "p01",
    date: "21 Sep 2026",
    duration: "08:42",
    mode: "Voice",
    messages: [
      {
        id: "m01",
        speaker: "interviewer",
        time: "00:12",
        text: "Tell me about the last time your priorities changed during a working day.",
      },
      {
        id: "m02",
        speaker: "participant",
        time: "00:28",
        text: "Yesterday I had three hours blocked for planning. A client message came in and I spent most of that time finding out who owned the next step.",
      },
      {
        id: "m03",
        speaker: "interviewer",
        time: "01:04",
        text: "How did you find out who was responsible?",
      },
      {
        id: "m04",
        speaker: "participant",
        time: "01:17",
        text: "I checked our board, then asked in chat. The work was written down, but the decision about who was doing it was somewhere else.",
      },
    ],
  },
  {
    id: "c02",
    studyId: "everyday-work",
    participantId: "p02",
    date: "20 Sep 2026",
    duration: "06:15",
    mode: "Text",
    messages: [
      {
        id: "m05",
        speaker: "interviewer",
        time: "00:10",
        text: "What helped your team decide what to work on this week?",
      },
      {
        id: "m06",
        speaker: "participant",
        time: "00:35",
        text: "We had a quick call on Monday. The list was already there, but we needed to agree what could wait. Another list wouldn't have helped.",
      },
    ],
  },
  {
    id: "c03",
    studyId: "pricing-confidence",
    participantId: "p04",
    date: "19 Sep 2026",
    duration: "09:08",
    mode: "Voice",
    messages: [
      {
        id: "m07",
        speaker: "interviewer",
        time: "00:18",
        text: "Think about the last software subscription you approved. What informed that decision?",
      },
      {
        id: "m08",
        speaker: "participant",
        time: "00:42",
        text: "We tried it on a real project first. Seeing the team use it without reminders mattered more than the feature comparison.",
      },
    ],
  },
];
export const findings: Finding[] = [
  {
    id: "f01",
    studyId: "everyday-work",
    title: "Ownership gets lost between tools",
    description:
      "One participant described interrupting focused work to find the owner of a task. This is an early signal, not a conclusion about all teams.",
    sources: [
      { conversationId: "c01", messageId: "m02" },
      { conversationId: "c01", messageId: "m04" },
    ],
  },
  {
    id: "f02",
    studyId: "everyday-work",
    title: "A shared decision matters more than another list",
    description:
      "One participant valued agreeing on trade-offs together. Explore how other teams make these decisions before generalizing.",
    sources: [{ conversationId: "c02", messageId: "m06" }],
  },
  {
    id: "f03",
    studyId: "pricing-confidence",
    title: "Actual use helped justify the purchase",
    description:
      "A buyer described a real-project trial as more useful than a feature comparison. Further interviews would help test this signal.",
    sources: [{ conversationId: "c03", messageId: "m08" }],
  },
];
export const templates = [
  {
    id: "discovery",
    name: "Customer discovery",
    description: "Understand the problem before the solution.",
    goal: "Understand recent customer experiences, current alternatives, and unmet needs.",
    mark: "01",
  },
  {
    id: "pmf",
    name: "PMF research",
    description: "Find out what people would miss most.",
    goal: "Learn who gets the most value from the product and why they return.",
    mark: "02",
  },
  {
    id: "concept",
    name: "Concept testing",
    description: "Explore reactions, questions, and trade-offs.",
    goal: "Explore how participants understand a concept and which trade-offs matter.",
    mark: "03",
  },
  {
    id: "pricing",
    name: "Pricing research",
    description: "Learn how customers think about value.",
    goal: "Understand how customers evaluate value and make purchase decisions.",
    mark: "04",
  },
  {
    id: "product",
    name: "Product research",
    description: "Understand how a product fits into real life.",
    goal: "Explore recent product use, friction, and unmet expectations.",
    mark: "05",
  },
  {
    id: "feedback",
    name: "Customer feedback",
    description: "Make room for what customers need to say.",
    goal: "Learn what is working, what feels difficult, and what customers need next.",
    mark: "06",
  },
  {
    id: "sales",
    name: "Sales discovery",
    description: "Understand a client's needs and context.",
    goal: "Explore the client's current process, priorities, and decision criteria.",
    mark: "07",
  },
  {
    id: "survey",
    name: "Conversational research",
    description: "Go a little deeper than a fixed response.",
    goal: "Gather structured perspectives while leaving room for unexpected context.",
    mark: "08",
  },
];
export const getStudy = (id: string) =>
  studies.find((study) => study.id === id);
export const studyConversations = (id: string) =>
  conversations.filter((item) => item.studyId === id);
export const studyFindings = (id: string) =>
  findings.filter((item) => item.studyId === id);
export const getParticipant = (id: string) =>
  participants.find((item) => item.id === id)!;

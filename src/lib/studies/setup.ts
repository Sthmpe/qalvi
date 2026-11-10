// The researcher-authored study setup, shared by the editor, the server actions
// and the study pages. Pure functions only: no Supabase, no React.
//
// A visual is optional and attached to one objective. Its data is written by the
// researcher and validated with the same parser the interview room uses, so the
// AI never authors a visual and the room never renders anything unvalidated.
import { parseDisplayAction, type DisplayAction } from "@/components/interview/visuals/display";
import type { Json } from "@/types/database";

export type StudyStatus = "draft" | "active" | "completed" | "archived";
export type ObjectivePriority = "high" | "low";
export type VisualType = DisplayAction["type"];

export type StudyObjective = {
  id: string;
  topic: string;
  priority: ObjectivePriority;
  visual: DisplayAction | null;
};

export type StudySetup = {
  title: string;
  description: string;
  researchGoal: string;
  audience: string;
  category: string;
  objectives: StudyObjective[];
  assumptions: string[];
  status: StudyStatus;
};

export type Study = StudySetup & {
  id: string;
  updatedAt: string;
  createdAt: string;
};

export type SetupErrors = Partial<Record<
  "title" | "description" | "researchGoal" | "audience" | "category" | "objectives" | "assumptions" | "status",
  string
>> & { objective?: Record<string, string> };

export type SetupResult = { ok: true; value: StudySetup } | { ok: false; errors: SetupErrors };

export const LIMITS = {
  title: 200,
  description: 500,
  researchGoal: 1200,
  audience: 300,
  category: 60,
  objectives: 10,
  objectiveTopic: 300,
  assumptions: 10,
  assumption: 300,
  visualPrompt: 300,
  visualText: 120,
  visualJson: 4000,
} as const;

/** Statuses a researcher may choose in the editor. Archive arrives with retention controls. */
export const EDITABLE_STATUSES: StudyStatus[] = ["draft", "active", "completed"];
export const STATUS_LABEL: Record<StudyStatus, string> = {
  draft: "Draft",
  active: "Active",
  completed: "Closed",
  archived: "Archived",
};
export const VISUAL_LABEL: Record<VisualType, string> = {
  comparison_cards: "Comparison cards",
  multiple_choice: "Multiple choice",
  slider: "Slider",
  bar_chart: "Bar chart",
};

const OBJECTIVE_ID = /^[a-z0-9_]{1,40}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function visualId(objectiveId: string) {
  return `study-${objectiveId}`;
}

/** A new objective identifier: stable across edits, never derived from participant data. */
export function newObjectiveId(existing: Iterable<string> = []) {
  const taken = new Set(existing);
  for (;;) {
    const id = `obj_${Math.random().toString(36).slice(2, 8)}`;
    if (OBJECTIVE_ID.test(id) && !taken.has(id)) return id;
  }
}

function visualTextTooLong(visual: DisplayAction) {
  const labels: string[] = [];
  if (visual.type === "comparison_cards" || visual.type === "multiple_choice") {
    for (const option of visual.options) labels.push(option.label, option.description ?? "");
  } else if (visual.type === "bar_chart") {
    for (const bar of visual.bars) labels.push(bar.label);
    labels.push(visual.unit ?? "");
  } else {
    labels.push(visual.unit ?? "", visual.minLabel ?? "", visual.maxLabel ?? "");
  }
  return labels.some((label) => label.length > LIMITS.visualText);
}

/** Validate one researcher-authored visual for an objective. Returns an error message or the visual. */
export function validateVisual(objectiveId: string, input: unknown): DisplayAction | string {
  const parsed = parseDisplayAction(input);
  if (!parsed) return "Complete every field of this visual. Choices need at least two distinct options.";
  if (parsed.id !== visualId(objectiveId)) return "This visual does not belong to its objective.";
  if (parsed.prompt.trim().length > LIMITS.visualPrompt) return "Keep the on-screen question shorter.";
  if (visualTextTooLong(parsed)) return `Keep labels under ${LIMITS.visualText} characters.`;
  if (parsed.type === "comparison_cards" && parsed.options.length > 4) return "Use at most four comparison cards.";
  if (parsed.type === "slider" && (parsed.max - parsed.min) / parsed.step > 1000) return "Use a larger slider step.";
  if (JSON.stringify(parsed).length > LIMITS.visualJson) return "This visual is too large.";
  return { ...parsed, prompt: parsed.prompt.trim() };
}

/** The complete, trusted check before anything is written. Activation needs a usable interview plan. */
export function validateStudySetup(input: unknown): SetupResult {
  const errors: SetupErrors = {};
  if (!isRecord(input)) return { ok: false, errors: { title: "The study could not be read." } };
  const title = text(input.title);
  const description = text(input.description);
  const researchGoal = text(input.researchGoal);
  const audience = text(input.audience);
  const category = text(input.category);
  const status = input.status as StudyStatus;

  if (!title) errors.title = "Give the study a name.";
  else if (title.length > LIMITS.title) errors.title = "Keep the name shorter.";
  if (description.length > LIMITS.description) errors.description = "Keep the summary shorter.";
  if (researchGoal.length > LIMITS.researchGoal) errors.researchGoal = "Keep the goal shorter.";
  if (audience.length > LIMITS.audience) errors.audience = "Keep this description shorter.";
  if (category.length > LIMITS.category) errors.category = "Keep the category shorter.";
  if (!EDITABLE_STATUSES.includes(status)) errors.status = "Choose a status.";

  const objectives: StudyObjective[] = [];
  const objectiveErrors: Record<string, string> = {};
  const rawObjectives = Array.isArray(input.objectives) ? input.objectives : null;
  if (!rawObjectives) errors.objectives = "Objectives could not be read.";
  else if (rawObjectives.length > LIMITS.objectives) errors.objectives = `Use at most ${LIMITS.objectives} objectives.`;
  else {
    const seen = new Set<string>();
    for (const item of rawObjectives) {
      if (!isRecord(item) || typeof item.id !== "string" || !OBJECTIVE_ID.test(item.id) || seen.has(item.id)) {
        errors.objectives = "An objective could not be read. Reload and try again.";
        break;
      }
      seen.add(item.id);
      const topic = text(item.topic);
      const priority: ObjectivePriority = item.priority === "low" ? "low" : "high";
      if (!topic) objectiveErrors[item.id] = "Describe what you want to learn, or remove this objective.";
      else if (topic.length > LIMITS.objectiveTopic) objectiveErrors[item.id] = "Keep this objective shorter.";
      let visual: DisplayAction | null = null;
      if (item.visual !== null && item.visual !== undefined) {
        const checked = validateVisual(item.id, item.visual);
        if (typeof checked === "string") objectiveErrors[item.id] ??= checked;
        else visual = checked;
      }
      objectives.push({ id: item.id, topic, priority, visual });
    }
  }
  if (Object.keys(objectiveErrors).length) errors.objective = objectiveErrors;

  const assumptions: string[] = [];
  if (!Array.isArray(input.assumptions)) errors.assumptions = "Assumptions could not be read.";
  else {
    for (const item of input.assumptions) {
      const value = text(item);
      if (value) assumptions.push(value);
    }
    if (assumptions.length > LIMITS.assumptions) errors.assumptions = `Use at most ${LIMITS.assumptions} assumptions.`;
    else if (assumptions.some((value) => value.length > LIMITS.assumption)) errors.assumptions = "Keep each assumption shorter.";
  }

  if (status === "active") {
    if (!researchGoal) errors.researchGoal ??= "An active study needs a research goal.";
    if (!audience) errors.audience ??= "An active study needs to say who you will interview.";
    if (!objectives.length) errors.objectives ??= "An active study needs at least one objective.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { title, description, researchGoal, audience, category, objectives, assumptions, status },
  };
}

/** Read objectives saved in the database. Anything malformed is dropped, never rendered. */
export function readObjectives(value: unknown): StudyObjective[] {
  if (!Array.isArray(value)) return [];
  const objectives: StudyObjective[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !OBJECTIVE_ID.test(item.id) || !text(item.topic)) continue;
    const visual = item.visual ? validateVisual(item.id, item.visual) : null;
    objectives.push({
      id: item.id,
      topic: text(item.topic),
      priority: item.priority === "low" ? "low" : "high",
      visual: visual && typeof visual !== "string" ? visual : null,
    });
  }
  return objectives;
}

export type StudyRow = {
  id: string;
  title: string;
  description: string | null;
  research_goal: string | null;
  audience: string | null;
  category: string | null;
  status: string;
  objectives: unknown;
  assumptions: string[] | null;
  created_at: string;
  updated_at: string;
};

export function studyFromRow(row: StudyRow): Study {
  const status = (["draft", "active", "completed", "archived"] as const).find((value) => value === row.status) ?? "draft";
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    researchGoal: row.research_goal ?? "",
    audience: row.audience ?? "",
    category: row.category ?? "",
    status,
    objectives: readObjectives(row.objectives),
    assumptions: row.assumptions ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Database column values for a validated setup. Ids, tenancy and authorship are never included. */
export function setupColumns(setup: StudySetup) {
  return {
    title: setup.title,
    description: setup.description || null,
    research_goal: setup.researchGoal || null,
    audience: setup.audience || null,
    category: setup.category || null,
    status: setup.status,
    assumptions: setup.assumptions,
    // Plain JSON by construction: validated strings, numbers and booleans only.
    objectives: setup.objectives.map(({ id, topic, priority, visual }) => ({
      id, topic, priority, ...(visual ? { visual } : {}),
    })) as unknown as Json,
  };
}

/** What still blocks an interview, in plain words. Empty when the study can be opened to participants. */
export function readinessGaps(setup: Pick<StudySetup, "researchGoal" | "audience" | "objectives">) {
  const gaps: string[] = [];
  if (!setup.researchGoal.trim()) gaps.push("a research goal");
  if (!setup.audience.trim()) gaps.push("who you want to interview");
  if (!setup.objectives.length) gaps.push("at least one objective");
  return gaps;
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(iso));
}

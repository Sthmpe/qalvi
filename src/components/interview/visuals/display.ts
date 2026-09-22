export interface VisualOption {
  id: string;
  label: string;
  description?: string;
}

export interface Bar {
  id: string;
  label: string;
  value: number;
}

/** Structured data for a predefined visual. The AI never sends markup or code. */
export type DisplayAction =
  | { type: "comparison_cards"; id: string; prompt: string; options: VisualOption[] }
  | { type: "bar_chart"; id: string; prompt: string; bars: Bar[]; unit?: string }
  | {
      type: "slider";
      id: string;
      prompt: string;
      min: number;
      max: number;
      step: number;
      initial: number;
      unit?: string;
      minLabel?: string;
      maxLabel?: string;
    }
  | { type: "multiple_choice"; id: string; prompt: string; options: VisualOption[]; multiple?: boolean };

export type VisualResponse =
  | { actionId: string; type: "comparison_cards"; optionId: string }
  | { actionId: string; type: "slider"; value: number }
  | { actionId: string; type: "multiple_choice"; optionIds: string[] };

/** Prefix on chat messages that carry an on-screen answer, so the agent can tell them apart. */
export const RESPONSE_PREFIX = "[On screen]";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optionalText = (value: unknown) => value === undefined || typeof value === "string";

function parseOptions(value: unknown, requireDescription: boolean): VisualOption[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) return null;
  const options: VisualOption[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.label)) return null;
    const { description } = item;
    if (description !== undefined && typeof description !== "string") return null;
    if (requireDescription && !isText(description)) return null;
    options.push({ id: item.id, label: item.label, ...(description ? { description } : {}) });
  }
  return new Set(options.map((option) => option.id)).size === options.length ? options : null;
}

export function parseDisplayAction(input: unknown): DisplayAction | null {
  if (!isRecord(input) || !isText(input.id) || !isText(input.prompt)) return null;
  const { id, prompt } = input;
  switch (input.type) {
    case "comparison_cards": {
      const options = parseOptions(input.options, true);
      return options ? { type: "comparison_cards", id, prompt, options } : null;
    }
    case "multiple_choice": {
      const options = parseOptions(input.options, false);
      if (!options || (input.multiple !== undefined && typeof input.multiple !== "boolean")) return null;
      return { type: "multiple_choice", id, prompt, options, ...(input.multiple ? { multiple: true } : {}) };
    }
    case "bar_chart": {
      if (!Array.isArray(input.bars) || input.bars.length < 2 || input.bars.length > 8 || !optionalText(input.unit)) return null;
      const bars: Bar[] = [];
      for (const item of input.bars) {
        if (!isRecord(item) || !isText(item.id) || !isText(item.label) || !isNumber(item.value) || item.value < 0) return null;
        bars.push({ id: item.id, label: item.label, value: item.value });
      }
      if (new Set(bars.map((bar) => bar.id)).size !== bars.length) return null;
      return { type: "bar_chart", id, prompt, bars, ...(input.unit ? { unit: input.unit } : {}) };
    }
    case "slider": {
      const { min, max, step, initial, unit, minLabel, maxLabel } = input;
      if (!isNumber(min) || !isNumber(max) || !isNumber(step) || !isNumber(initial)) return null;
      if (min >= max || step <= 0 || initial < min || initial > max) return null;
      if (!optionalText(unit) || !optionalText(minLabel) || !optionalText(maxLabel)) return null;
      return {
        type: "slider", id, prompt, min, max, step, initial,
        ...(unit ? { unit } : {}), ...(minLabel ? { minLabel } : {}), ...(maxLabel ? { maxLabel } : {}),
      };
    }
    default:
      return null;
  }
}

export function formatValue(value: number, unit?: string) {
  if (!unit) return String(value);
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}

/** Plain-language summary of an answer, shown in the transcript and sent to the agent. */
export function describeResponse(action: DisplayAction, response: VisualResponse): string | null {
  if (action.id !== response.actionId) return null;
  const label = (id: string) =>
    action.type === "comparison_cards" || action.type === "multiple_choice"
      ? action.options.find((option) => option.id === id)?.label
      : undefined;
  switch (response.type) {
    case "comparison_cards": {
      const chosen = action.type === "comparison_cards" ? label(response.optionId) : undefined;
      return chosen ? `Chose "${chosen}"` : null;
    }
    case "multiple_choice": {
      if (action.type !== "multiple_choice" || !response.optionIds.length) return null;
      const chosen = response.optionIds.map(label);
      return chosen.every(Boolean) ? `Chose ${chosen.map((item) => `"${item}"`).join(", ")}` : null;
    }
    case "slider":
      if (action.type !== "slider" || response.value < action.min || response.value > action.max) return null;
      return `Set ${formatValue(response.value, action.unit)}`;
  }
}

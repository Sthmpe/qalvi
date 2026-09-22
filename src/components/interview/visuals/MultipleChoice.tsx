import { useState } from "react";
import type { DisplayAction, VisualResponse } from "./display";

interface MultipleChoiceProps {
  action: Extract<DisplayAction, { type: "multiple_choice" }>;
  response: VisualResponse | null;
  busy: boolean;
  onRespond: (response: VisualResponse) => void;
}

export default function MultipleChoice({ action, response, busy, onRespond }: MultipleChoiceProps) {
  const shared = response?.type === "multiple_choice" ? response.optionIds : null;
  const [picked, setPicked] = useState<string[]>([]);
  const chosen = shared ?? picked;
  const locked = shared !== null || busy;

  function choose(id: string) {
    if (!action.multiple) {
      setPicked([id]);
      return;
    }
    setPicked((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  }

  return (
    <div className="flex flex-col gap-3">
      {action.multiple && <p className="text-xs text-[var(--muted)]">Choose any that apply.</p>}
      <div className="flex flex-col gap-2">
        {action.options.map((option) => {
          const selected = chosen.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={locked}
              aria-pressed={selected}
              onClick={() => choose(option.id)}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-[border-color,box-shadow,opacity] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-default ${
                selected
                  ? "border-[var(--accent)] bg-[var(--surface)] shadow-[0_0_0_1px_var(--accent)] text-[var(--foreground)]"
                  : `border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] ${locked ? "opacity-50" : "hover:border-[var(--accent)]/40"}`
              }`}
            >
              <span
                aria-hidden
                className={`h-3 w-3 shrink-0 border transition-colors ${action.multiple ? "rounded-[3px]" : "rounded-full"} ${
                  selected ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)]"
                }`}
              />
              {option.label}
            </button>
          );
        })}
      </div>
      {shared === null && (
        <button
          type="button"
          disabled={busy || picked.length === 0}
          onClick={() => onRespond({ actionId: action.id, type: "multiple_choice", optionIds: picked })}
          className="visual-submit"
        >
          {busy ? "Sharing…" : "Confirm selection"}
        </button>
      )}
    </div>
  );
}

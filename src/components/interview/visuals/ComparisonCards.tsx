import { useState } from "react";
import type { DisplayAction, VisualResponse } from "./display";

interface ComparisonCardsProps {
  action: Extract<DisplayAction, { type: "comparison_cards" }>;
  response: VisualResponse | null;
  busy: boolean;
  onRespond: (response: VisualResponse) => void;
}

export default function ComparisonCards({ action, response, busy, onRespond }: ComparisonCardsProps) {
  const shared = response?.type === "comparison_cards" ? response.optionId : null;
  const [picked, setPicked] = useState<string | null>(null);
  const chosenId = shared ?? picked;
  const locked = shared !== null || busy;

  return (
    <div>
    <div className="comparison-options">
      {action.options.map((option) => {
        const selected = option.id === chosenId;
        return (
          <button
            key={option.id}
            type="button"
            disabled={locked}
            aria-pressed={selected}
            onClick={() => setPicked(option.id)}
            className={`flex flex-1 flex-col gap-2 rounded-2xl border px-5 py-4 text-left transition-[border-color,box-shadow,opacity] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-default ${
              selected
                ? "border-[var(--accent)] bg-[var(--surface)] shadow-[0_0_0_1px_var(--accent)]"
                : `border-[var(--border)] bg-[var(--surface)] ${locked ? "opacity-50" : "hover:border-[var(--accent)]/40"}`
            }`}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[var(--foreground)]">{option.label}</span>
              <span
                aria-hidden
                className={`h-2.5 w-2.5 shrink-0 rounded-full border transition-colors ${
                  selected ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)]"
                }`}
              />
            </span>
            <span className="text-xs leading-relaxed text-[var(--muted)]">{option.description}</span>
          </button>
        );
      })}
    </div>
    {shared === null && <button type="button" className="visual-submit" disabled={busy || !picked}
      onClick={() => { if (picked) onRespond({ actionId: action.id, type: "comparison_cards", optionId: picked }); }}>
      {busy ? "Sharing…" : "Confirm selection"}
    </button>}
    </div>
  );
}

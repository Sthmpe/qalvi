import type { ConceptOption } from "./types";

interface ConceptCardProps {
  option: ConceptOption;
  selected: boolean;
  revealed: boolean;
  onSelect: (id: string) => void;
}

/**
 * A single predefined, reusable visual component.
 * The interview engine will later supply `option` data — this component
 * never receives or executes arbitrary AI-generated code.
 */
export default function ConceptCard({ option, selected, revealed, onSelect }: ConceptCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.id)}
      className={`group flex flex-1 flex-col gap-3 rounded-2xl border px-5 py-4 text-left transition-all duration-300 ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)]/40 shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)]/15"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--foreground)]">{option.label}</span>
        <span
          className={`h-2.5 w-2.5 rounded-full border transition-colors ${
            selected ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)]"
          }`}
          aria-hidden
        />
      </div>
      <p className="text-xs leading-relaxed text-[var(--muted)]">{option.description}</p>

      {/* Mini deterministic bar — mocked data, no chart library needed yet */}
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]/60">
        <div
          className={`h-full rounded-full bg-[var(--accent)] transition-all duration-700 ease-out ${
            revealed ? "" : "w-0"
          }`}
          style={{ width: revealed ? `${option.interestScore}%` : undefined }}
        />
      </div>
    </button>
  );
}

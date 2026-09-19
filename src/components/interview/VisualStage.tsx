import { useEffect, useState } from "react";
import ConceptCard from "./ConceptCard";
import type { ConceptOption } from "./types";

interface VisualStageProps {
  options: ConceptOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * The stage where interactive research material (charts, cards, sliders)
 * will appear during the conversation. For Milestone 1 this renders one
 * mocked comparison-card example with an inline mini bar chart.
 */
export default function VisualStage({ options, selectedId, onSelect }: VisualStageProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 150);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="animate-fade-in-up rounded-3xl border border-[var(--border)] bg-[var(--surface)]/60 p-4 sm:p-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        Which direction feels closest to what you&apos;d want?
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {options.map((option) => (
          <ConceptCard
            key={option.id}
            option={option}
            selected={selectedId === option.id}
            revealed={revealed}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

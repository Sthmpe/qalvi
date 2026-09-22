import { useEffect, useState } from "react";
import { formatValue, type DisplayAction } from "./display";

interface BarChartProps {
  action: Extract<DisplayAction, { type: "bar_chart" }>;
}

/** Display-only. Bar widths are computed here from the supplied values, never by the AI. */
export default function BarChart({ action }: BarChartProps) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const largest = Math.max(...action.bars.map((bar) => bar.value), 1);

  return (
    <ul className="flex flex-col gap-3">
      {action.bars.map((bar) => (
        <li key={bar.id} className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium text-[var(--foreground)]">{bar.label}</span>
            <span className="tabular-nums text-[var(--muted)]">{formatValue(bar.value, action.unit)}</span>
          </span>
          <span className="block h-2 w-full overflow-hidden rounded-full bg-[var(--border)]/60">
            <span
              className="block h-full rounded-full bg-[var(--accent)] motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
              style={{ width: revealed ? `${(bar.value / largest) * 100}%` : 0 }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

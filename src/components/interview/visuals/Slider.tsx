import { useState, type CSSProperties } from "react";
import { formatValue, type DisplayAction, type VisualResponse } from "./display";

interface SliderProps {
  action: Extract<DisplayAction, { type: "slider" }>;
  response: VisualResponse | null;
  busy: boolean;
  onRespond: (response: VisualResponse) => void;
}

export default function Slider({ action, response, busy, onRespond }: SliderProps) {
  const shared = response?.type === "slider" ? response.value : null;
  const [value, setValue] = useState(action.initial);
  const current = shared ?? value;
  const locked = shared !== null || busy;
  const fill = ((current - action.min) / (action.max - action.min)) * 100;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-2xl font-medium tabular-nums tracking-tight text-[var(--foreground)]">
        {formatValue(current, action.unit)}
      </p>
      <input
        type="range"
        aria-label={action.prompt}
        aria-valuetext={formatValue(current, action.unit)}
        min={action.min}
        max={action.max}
        step={action.step}
        value={current}
        disabled={locked}
        onChange={(event) => setValue(Number(event.target.value))}
        className="qalvi-range"
        style={{ "--fill": `${fill}%` } as CSSProperties}
      />
      {(action.minLabel || action.maxLabel) && (
        <div className="flex justify-between text-xs text-[var(--muted)]" aria-hidden>
          <span>{action.minLabel}</span>
          <span>{action.maxLabel}</span>
        </div>
      )}
      {shared === null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRespond({ actionId: action.id, type: "slider", value })}
          className="visual-submit"
        >
          {busy ? "Sharing…" : "Confirm value"}
        </button>
      )}
    </div>
  );
}

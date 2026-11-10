import BarChart from "./visuals/BarChart";
import ComparisonCards from "./visuals/ComparisonCards";
import MultipleChoice from "./visuals/MultipleChoice";
import Slider from "./visuals/Slider";
import { formatValue, type DisplayAction, type VisualResponse } from "./visuals/display";

interface VisualStageProps {
  action: DisplayAction;
  response: VisualResponse | null;
  busy: boolean;
  onRespond: (response: VisualResponse) => void;
  preview?: boolean;
  /** Real study rooms: the visual is reference material and the participant answers by speaking or typing. */
  inWords?: boolean;
}

/** A calm, read-only rendering of a visual for answering in words. Nothing here can be tapped. */
function ReferenceVisual({ action }: { action: Exclude<DisplayAction, { type: "bar_chart" }> }) {
  if (action.type === "slider") {
    return (
      <div className="reference-range">
        <span><strong>{formatValue(action.min, action.unit)}</strong>{action.minLabel && ` · ${action.minLabel}`}</span>
        <span aria-hidden="true" className="reference-range-line" />
        <span><strong>{formatValue(action.max, action.unit)}</strong>{action.maxLabel && ` · ${action.maxLabel}`}</span>
      </div>
    );
  }
  return (
    <ul className={action.type === "comparison_cards" ? "reference-options reference-options--cards" : "reference-options"}>
      {action.options.map((option) => (
        <li key={option.id}>
          <strong>{option.label}</strong>
          {option.description && <span>{option.description}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Where research material appears during the conversation. Each action type
 * maps to one predefined component; the AI supplies data, never markup.
 */
export default function VisualStage({ action, response, busy, onRespond, preview = false, inWords = false }: VisualStageProps) {
  if (inWords && action.type !== "bar_chart") {
    return (
      <section aria-label="On screen" className="visual-stage animate-fade-in-up">
        <div className="visual-stage-heading"><p className="participant-eyebrow">LET’S EXPLORE</p><span>Answer in your own words</span></div>
        <h2 className="visual-prompt">{action.prompt}</h2>
        <p className="visual-hint">{action.type === "slider"
          ? "Say or type roughly where you are on this range, and why."
          : action.type === "multiple_choice" ? "Say or type which of these apply, and why." : "Say or type which one fits best, and why."}</p>
        <ReferenceVisual action={action} />
      </section>
    );
  }
  return (
    <section
      aria-label="On screen"
      className="visual-stage animate-fade-in-up"
    >
      <div className="visual-stage-heading"><p className="participant-eyebrow">{action.type === "bar_chart" ? "A LITTLE CONTEXT" : "LET’S EXPLORE"}</p><span>{action.type === "bar_chart" ? "For discussion" : response ? "Answer confirmed" : "Your perspective"}</span></div>
      <h2 className="visual-prompt">{action.prompt}</h2>
      {action.type !== "bar_chart" && !response && <p className="visual-hint">Take your time. You can change your answer before confirming.</p>}
      {action.type === "comparison_cards" && (
        <ComparisonCards action={action} response={response} busy={busy} onRespond={onRespond} />
      )}
      {action.type === "bar_chart" && <BarChart action={action} />}
      {action.type === "slider" && <Slider action={action} response={response} busy={busy} onRespond={onRespond} />}
      {action.type === "multiple_choice" && (
        <MultipleChoice action={action} response={response} busy={busy} onRespond={onRespond} />
      )}
      {response && (
        <p role="status" className="visual-confirmation">
          <span aria-hidden="true">✓</span> {preview ? "Confirmed in this preview only. Nothing was sent." : "Answer shared. Continue the conversation with Qalvi."}
        </p>
      )}
    </section>
  );
}

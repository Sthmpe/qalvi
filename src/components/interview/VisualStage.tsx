import BarChart from "./visuals/BarChart";
import ComparisonCards from "./visuals/ComparisonCards";
import MultipleChoice from "./visuals/MultipleChoice";
import Slider from "./visuals/Slider";
import type { DisplayAction, VisualResponse } from "./visuals/display";

interface VisualStageProps {
  action: DisplayAction;
  response: VisualResponse | null;
  busy: boolean;
  onRespond: (response: VisualResponse) => void;
  preview?: boolean;
}

/**
 * Where research material appears during the conversation. Each action type
 * maps to one predefined component; the AI supplies data, never markup.
 */
export default function VisualStage({ action, response, busy, onRespond, preview = false }: VisualStageProps) {
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

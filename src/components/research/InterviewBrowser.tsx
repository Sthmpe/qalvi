"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { VISUAL_LABEL, formatDate, type StudyObjective } from "@/lib/studies/setup";
import type { InterviewDetail, InterviewStatus, InterviewSummary, ShownVisual } from "@/lib/research/results";

export const STATUS_COPY: Record<InterviewStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  interrupted: "Interrupted",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Ended early",
};
const COVERAGE_COPY = { covered: "Covered", partial: "Partly covered", not_covered: "Not covered" } as const;
const LIVE: InterviewStatus[] = ["pending", "in_progress", "interrupted"];

function elapsed(from: string, to: string) {
  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ShownOnScreen({ visual }: { visual: ShownVisual }) {
  const { action } = visual;
  return (
    <aside className="evidence-visual" aria-label="Shown on screen">
      <span>Shown on screen · {VISUAL_LABEL[action.type]}</span>
      <p>{action.prompt}</p>
      {(action.type === "comparison_cards" || action.type === "multiple_choice") && (
        <ul>{action.options.map((option) => <li key={option.id}>{option.label}</li>)}</ul>
      )}
      {action.type === "bar_chart" && (
        <ul>{action.bars.map((bar) => <li key={bar.id}>{bar.label}: {bar.value}{action.unit ?? ""}</li>)}</ul>
      )}
      {action.type === "slider" && <ul><li>Range {action.min} to {action.max}{action.unit ? ` ${action.unit}` : ""}</li></ul>}
    </aside>
  );
}

export default function InterviewBrowser({ studyId, interviews, selected, objectives, cited }: {
  studyId: string;
  interviews: InterviewSummary[];
  selected: InterviewDetail;
  objectives: StudyObjective[];
  cited: Record<string, { id: string; title: string }[]>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState("all");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"analysis" | "cancel" | null>(null);
  const [, startTransition] = useTransition();

  const first = selected.transcript[0]?.occurredAt ?? selected.startedAt;
  const messages = selected.transcript.filter((message) =>
    (speaker === "all" || message.speaker === speaker) &&
    message.content.toLowerCase().includes(query.trim().toLowerCase()));
  const filtering = Boolean(query.trim()) || speaker !== "all";
  const visualsBefore = useMemo(() => {
    const placed = new Map<string, ShownVisual[]>();
    for (const visual of selected.visuals) {
      const next = selected.transcript.find((message) => message.occurredAt >= visual.issuedAt);
      const key = next?.id ?? "end";
      placed.set(key, [...(placed.get(key) ?? []), visual]);
    }
    return placed;
  }, [selected]);
  const answers = new Set(selected.visuals.map((visual) => visual.answerMessageId).filter(Boolean));
  const topic = (id: string) => objectives.find((objective) => objective.id === id)?.topic ?? "Objective no longer in the study";

  async function post(kind: "analysis" | "cancel") {
    setBusy(kind);
    setNotice(kind === "analysis" ? "Analysing this interview. This can take up to a minute." : "");
    try {
      const response = await fetch(`/api/research/conversations/${selected.id}/${kind}`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string; findings?: number };
      if (!response.ok) setNotice(body.error ?? "That did not work. Please try again.");
      else setNotice(kind === "analysis"
        ? `Analysis saved with ${body.findings ?? 0} proposed ${body.findings === 1 ? "finding" : "findings"}, each linked to its evidence.`
        : "The interview was cancelled.");
    } catch {
      setNotice("That did not work. Please try again.");
    } finally {
      setBusy(null);
      startTransition(() => router.refresh());
    }
  }

  const analysis = selected.detail;
  const hasParticipantWords = selected.transcript.some((message) => message.speaker === "participant");
  return (
    <div className="evidence-browser">
      <nav className="conversation-picker" aria-label="Interviews">
        <p className="q-eyebrow">INTERVIEWS · {interviews.length}</p>
        {interviews.map((interview) => (
          <Link
            key={interview.id}
            className={selected.id === interview.id ? "selected" : ""}
            aria-current={selected.id === interview.id ? "page" : undefined}
            href={`/studies/${studyId}/interviews?conversation=${interview.id}`}
          >
            <strong>{interview.participant}</strong>
            <span>{formatDate(interview.startedAt)} · {STATUS_COPY[interview.status]}</span>
          </Link>
        ))}
      </nav>
      <div className="evidence-column">
        <Card className="evidence-panel">
          <div className="evidence-header">
            <div>
              <h2>{selected.participant}</h2>
              <p>
                {formatDate(selected.startedAt)} · {STATUS_COPY[selected.status]} · {selected.transcript.length}{" "}
                {selected.transcript.length === 1 ? "message" : "messages"}
              </p>
            </div>
            <Badge>Original transcript</Badge>
          </div>
          <div className="evidence-toolbar">
            <label>
              <span className="sr-only">Search original messages</span>
              <input type="search" placeholder="Search original messages…" value={query}
                onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label>
              <span className="sr-only">Filter by speaker</span>
              <select value={speaker} onChange={(event) => setSpeaker(event.target.value)}>
                <option value="all">All speakers</option>
                <option value="participant">Participant only</option>
                <option value="interviewer">Qalvi only</option>
              </select>
            </label>
          </div>
          <p className="results-count" role="status">
            {messages.length} of {selected.transcript.length} messages
          </p>
          <div className="evidence-messages">
            {messages.map((message) => (
              <div key={message.id}>
                {!filtering && visualsBefore.get(message.id)?.map((visual) => <ShownOnScreen key={visual.id} visual={visual} />)}
                <article id={`m-${message.id}`} className={`evidence-message ${message.speaker}`}>
                  <div>
                    <strong>{message.speaker === "participant" ? selected.participant : "Qalvi"}</strong>
                    <span>
                      {elapsed(first, message.occurredAt)} ·{" "}
                      {answers.has(message.id) || message.channel === "visual" ? "answered on screen" : message.channel === "voice" ? "spoken" : "typed"}
                      {message.interrupted ? " · interrupted" : ""}
                    </span>
                  </div>
                  <p>{message.content}</p>
                  {cited[message.id]?.map((finding) => (
                    <Link key={finding.id} className="evidence-finding-link text-link" href={`/studies/${studyId}/findings#f-${finding.id}`}>
                      Cited in: {finding.title} <span aria-hidden="true">↗</span>
                    </Link>
                  ))}
                </article>
              </div>
            ))}
            {!filtering && visualsBefore.get("end")?.map((visual) => <ShownOnScreen key={visual.id} visual={visual} />)}
            {!messages.length && (
              <div className="inline-empty">
                <p>{selected.transcript.length ? "No messages match these filters." : "Nothing has been said in this interview yet."}</p>
                {filtering && <Button variant="quiet" onClick={() => { setQuery(""); setSpeaker("all"); }}>Clear filters</Button>}
              </div>
            )}
          </div>
          <p className="evidence-footnote">
            Messages are stored exactly as received and cannot be edited. Interpretations live separately, below.
          </p>
        </Card>

        <Card className="analysis-panel">
          <div className="analysis-heading">
            <div>
              <span className="q-eyebrow">AI INTERPRETATION · DERIVED FROM THIS TRANSCRIPT</span>
              <h2>Summary and objective coverage</h2>
            </div>
            <div className="button-row">
              {LIVE.includes(selected.status) && (
                <Button variant="secondary" disabled={busy !== null} onClick={() => void post("cancel")}>
                  {busy === "cancel" ? "Cancelling…" : "Cancel interview"}
                </Button>
              )}
              <Button disabled={busy !== null || !hasParticipantWords} onClick={() => void post("analysis")}>
                {busy === "analysis" ? "Analysing…" : analysis ? "Analyse again" : "Analyse interview"}
              </Button>
            </div>
          </div>
          <p className="analysis-notice" role="status">{notice}</p>
          {!analysis && (
            <p className="quiet-note">
              {hasParticipantWords
                ? "Not analysed yet. Analysis proposes a summary, objective coverage and findings, each linked to the messages above. The transcript stays as it is either way."
                : "Analysis becomes available once the participant has said something."}
            </p>
          )}
          {analysis?.status === "failed" && (
            <p className="field-error">The last analysis did not finish: {analysis.error ?? "unknown error"}. The transcript is unaffected. You can try again.</p>
          )}
          {analysis?.status === "processing" && <p className="quiet-note">Analysis is in progress. Refresh in a moment.</p>}
          {analysis?.status === "completed" && (
            <>
              <p className="analysis-summary">{analysis.summary}</p>
              <ul className="coverage-list">
                {analysis.coverage.map((item) => (
                  <li key={item.id}>
                    <Badge tone={item.status === "covered" ? "indigo" : "neutral"}>{COVERAGE_COPY[item.status]}</Badge>
                    <div>
                      <p>{topic(item.id)}</p>
                      {item.message_ids.length > 0 && (
                        <span className="coverage-sources">
                          Evidence:{" "}
                          {item.message_ids.map((id, index) => (
                            <a key={id} className="text-link" href={`#m-${id}`}>message {index + 1}</a>
                          ))}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="quiet-note">
                Generated {analysis.completedAt ? formatDate(analysis.completedAt) : ""}. Proposed findings from this interview are on the{" "}
                <Link href={`/studies/${studyId}/findings`}>Findings tab</Link>.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

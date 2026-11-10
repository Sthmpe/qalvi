import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import { STATUS_LABEL, formatDate } from "@/lib/studies/setup";
import type { StudySummary } from "@/lib/studies/queries";

export default function StudyCard({ study }: { study: StudySummary }) {
  const objectives = study.objectives.length;
  return (
    <Link className="q-card study-card" href={`/studies/${study.id}`}>
      <div className="study-card-top">
        <span className="q-eyebrow">{study.category || "Study"}</span>
        <Badge tone={study.status === "active" ? "indigo" : "neutral"}>{STATUS_LABEL[study.status]}</Badge>
      </div>
      <h3>{study.title}</h3>
      <p>{study.description || study.researchGoal || "No research goal yet."}</p>
      <div className="study-card-footer">
        <span>
          <strong>{study.conversations}</strong> {study.conversations === 1 ? "conversation" : "conversations"}
          <span className="count-divider">/</span>
          <strong>{objectives}</strong> {objectives === 1 ? "objective" : "objectives"}
          <span className="count-divider">/</span>
          {formatDate(study.updatedAt)}
        </span>
        <span aria-hidden="true" className="card-arrow">↗</span>
      </div>
    </Link>
  );
}

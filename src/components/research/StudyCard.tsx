import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import {
  studyConversations,
  studyFindings,
  type Study,
} from "@/lib/research/mock-data";

export default function StudyCard({ study }: { study: Study }) {
  const interviewCount = studyConversations(study.id).length;
  const findingCount = studyFindings(study.id).length;
  return (
    <Link className="q-card study-card" href={`/studies/${study.id}`}>
      <div className="study-card-top">
        <span className="q-eyebrow">{study.category}</span>
        <Badge tone={study.status === "Active" ? "indigo" : "neutral"}>
          {study.status}
        </Badge>
      </div>
      <h3>{study.title}</h3>
      <p>{study.description}</p>
      <div className="study-card-footer">
        <span>
          <strong>{interviewCount}</strong> {interviewCount === 1 ? "interview" : "interviews"}
          <span className="count-divider">/</span>
          <strong>{findingCount}</strong> {findingCount === 1 ? "finding" : "findings"}
        </span>
        <span aria-hidden="true" className="card-arrow">
          ↗
        </span>
      </div>
    </Link>
  );
}

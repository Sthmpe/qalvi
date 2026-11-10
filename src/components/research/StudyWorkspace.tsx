import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, ButtonLink, Card, SectionHeading } from "@/components/ui/primitives";
import { STATUS_LABEL, VISUAL_LABEL, formatDate, readinessGaps, type Study } from "@/lib/studies/setup";
import type { StudyCounts } from "@/lib/studies/queries";
import { Navigation } from "./Navigation";

export function StudyWorkspace({ study, children }: { study: Study; children: ReactNode }) {
  const base = `/studies/${study.id}`;
  return (
    <>
      <Link href="/studies" className="breadcrumb">
        ← All studies
      </Link>
      <div className="study-heading">
        <div>
          <div className="study-heading-label">
            <span className="q-eyebrow">{study.category || "Study"}</span>
            <Badge tone={study.status === "active" ? "indigo" : "neutral"}>{STATUS_LABEL[study.status]}</Badge>
          </div>
          <h1>{study.title}</h1>
          {study.description && <p>{study.description}</p>}
        </div>
        <div className="study-actions">
          <div className="button-row">
            <ButtonLink href={`${base}/settings`} variant="secondary">Edit setup</ButtonLink>
          </div>
        </div>
      </div>
      <Navigation
        label="Study"
        className="study-tabs"
        items={[
          { href: base, label: "Overview" },
          { href: `${base}/interviews`, label: "Interviews" },
          { href: `${base}/participants`, label: "Participants" },
          { href: `${base}/findings`, label: "Findings" },
          { href: `${base}/settings`, label: "Setup" },
        ]}
      />
      <div className="study-content">{children}</div>
    </>
  );
}

export function StudyOverview({ study, counts, invitation }: { study: Study; counts: StudyCounts; invitation?: ReactNode }) {
  const gaps = readinessGaps(study);
  return (
    <>
      <div className="workspace-overview">
        <Card className="goal-card">
          <p className="q-eyebrow">THE QUESTION BEHIND THE STUDY</p>
          <h2>Research goal</h2>
          <p className="goal-text">{study.researchGoal || "No research goal yet."}</p>
          <div className="goal-meta">
            <div>
              <span>WHO WE’RE LISTENING TO</span>
              <p>{study.audience || "Not described yet"}</p>
            </div>
            <div>
              <span>CONVERSATION LENGTH</span>
              <p>About 7–12 minutes</p>
            </div>
          </div>
        </Card>
        <Card className="study-at-a-glance">
          <p className="q-eyebrow">AT A GLANCE</p>
          <div>
            <strong>{counts.conversations}</strong>
            <span>Conversations</span>
          </div>
          <div>
            <strong>{counts.participants}</strong>
            <span>Participants</span>
          </div>
          <div>
            <strong>{counts.findings}</strong>
            <span>Derived findings</span>
          </div>
        </Card>
      </div>
      {invitation}
      <section>
        <SectionHeading
          title="What each conversation pursues"
          description="Qalvi follows these objectives in order and adapts to what each participant says."
          action={<Link href={`/studies/${study.id}/settings`} className="text-link">Edit setup →</Link>}
        />
        {study.objectives.length ? (
          <Card className="objective-summary">
            <ol>
              {study.objectives.map((objective, index) => (
                <li key={objective.id}>
                  <span className="objective-number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <p>{objective.topic}</p>
                    <div className="objective-tags">
                      <Badge tone={objective.priority === "high" ? "indigo" : "neutral"}>
                        {objective.priority === "high" ? "Essential" : "Nice to have"}
                      </Badge>
                      {objective.visual && <Badge>{VISUAL_LABEL[objective.visual.type]}</Badge>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        ) : (
          <Card className="objective-summary objective-summary--empty">
            <p>No objectives yet. Add what each conversation should cover before inviting participants.</p>
          </Card>
        )}
      </section>
      {study.assumptions.length > 0 && (
        <section>
          <SectionHeading
            title="Assumptions to test"
            description="Listened for on both sides. Never stated to participants."
          />
          <Card className="objective-summary">
            <ul className="assumption-summary">
              {study.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
            </ul>
          </Card>
        </section>
      )}
      <p className="quiet-note">
        {gaps.length ? `Before this study can be active, add ${gaps.join(", ")}. ` : ""}
        Updated {formatDate(study.updatedAt)}
      </p>
    </>
  );
}

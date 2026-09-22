import Link from "next/link";
import type { ReactNode } from "react";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  SectionHeading,
} from "@/components/ui/primitives";
import {
  getParticipant,
  participants,
  studyConversations,
  studyFindings,
  type Study,
  type Finding,
} from "@/lib/research/mock-data";
import { Navigation } from "./Navigation";
import StudyActions from "./StudyActions";

export function StudyWorkspace({
  study,
  children,
}: {
  study: Study;
  children: ReactNode;
}) {
  const base = `/studies/${study.id}`;
  return (
    <>
      <Link href="/studies" className="breadcrumb">
        ← All studies
      </Link>
      <div className="study-heading">
        <div>
          <div className="study-heading-label">
            <span className="q-eyebrow">{study.category}</span>
            <Badge tone={study.status === "Active" ? "indigo" : "neutral"}>
              {study.status}
            </Badge>
          </div>
          <h1>{study.title}</h1>
          <p>{study.description}</p>
        </div>
        <StudyActions studyId={study.id} />
      </div>
      <Navigation
        label="Study"
        className="study-tabs"
        items={[
          { href: base, label: "Overview" },
          ...["interviews", "participants", "findings", "settings"].map(
            (tab) => ({
              href: `${base}/${tab}`,
              label: tab[0].toUpperCase() + tab.slice(1),
            }),
          ),
        ]}
      />
      <div className="study-content">{children}</div>
    </>
  );
}
export function FindingCard({ finding }: { finding: Finding }) {
  const interviews = studyConversations(finding.studyId);
  return (
    <article id={finding.id} className="q-card finding-card">
      <Badge>Illustrative finding · derived</Badge>
      <h3>{finding.title}</h3>
      <p>{finding.description}</p>
      <div className="source-links">
        {finding.sources.map((source) => {
          const conversation = interviews.find((item) => item.id === source.conversationId)!;
          const message = conversation.messages.find((item) => item.id === source.messageId)!;
          return (
          <Link
            key={`${source.conversationId}-${source.messageId}`}
            href={`/studies/${finding.studyId}/interviews?conversation=${source.conversationId}#${source.messageId}`}
            className="text-link"
          >
            {getParticipant(conversation.participantId).name} · {message.time}
            <span className="source-caption">Read supporting message ↗</span>
          </Link>
          );
        })}
      </div>
    </article>
  );
}
export function StudyOverview({ study }: { study: Study }) {
  const interviews = studyConversations(study.id);
  const derived = studyFindings(study.id);
  const people = participants.filter((person) => person.studyId === study.id);
  return (
    <>
      <div className="workspace-overview">
        <Card className="goal-card">
          <p className="q-eyebrow">THE QUESTION BEHIND THE STUDY</p>
          <h2>Research goal</h2>
          <p className="goal-text">{study.goal}</p>
          <div className="goal-meta">
            <div>
              <span>WHO WE’RE LISTENING TO</span>
              <p>{study.audience}</p>
            </div>
            <div>
              <span>CONVERSATION LENGTH</span>
              <p>About 7–12 minutes</p>
            </div>
          </div>
        </Card>
        <Card className="study-at-a-glance">
          <p className="q-eyebrow">AT A GLANCE · SAMPLE DATA</p>
          <div>
            <strong>{interviews.length}</strong>
            <span>Interviews</span>
          </div>
          <div>
            <strong>{people.length}</strong>
            <span>Participants</span>
          </div>
          <div>
            <strong>{derived.length}</strong>
            <span>Derived findings</span>
          </div>
        </Card>
      </div>
      <section>
        <SectionHeading
          title="Recent interviews"
          description="Begin with what people actually said."
          action={
            <Link
              href={`/studies/${study.id}/interviews`}
              className="text-link"
            >
              View evidence →
            </Link>
          }
        />
        {interviews.length ? (
          <Card className="interview-list">
            {interviews.map((conversation) => (
              <Link
                key={conversation.id}
                href={`/studies/${study.id}/interviews?conversation=${conversation.id}`}
                className="interview-row"
              >
                <span className="participant-avatar">
                  {getParticipant(conversation.participantId).name.slice(-2)}
                </span>
                <div>
                  <h3>{getParticipant(conversation.participantId).name}</h3>
                  <p>{getParticipant(conversation.participantId).role}</p>
                </div>
                <span className="interview-date">{conversation.date}</span>
                <Badge>{conversation.mode}</Badge>
                <span className="duration">{conversation.duration}</span>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </Card>
        ) : (
          <EmptyState
            title="Room for your first conversation"
            description="This sample study has no interviews yet. Explore the shared live demo to try the participant experience."
            action={
              <ButtonLink href="/interview/demo">Test interview</ButtonLink>
            }
          />
        )}
      </section>
      <section>
        <SectionHeading
          title="Emerging understanding"
          description="Derived findings, always one step away from the original words."
          action={
            <Link href={`/studies/${study.id}/findings`} className="text-link">
              All findings →
            </Link>
          }
        />
        <div className="finding-grid">
          {derived.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
        {!derived.length && (
          <EmptyState
            title="Evidence before conclusions"
            description="Findings will belong here once there are conversations to learn from. No findings are generated in this preview."
          />
        )}
      </section>
      <p className="quiet-note">
        Participant experience:{" "}
        <Link href={`/interview/${study.id}`}>Open invitation ↗</Link> · Updated{" "}
        {study.updated}
      </p>
    </>
  );
}

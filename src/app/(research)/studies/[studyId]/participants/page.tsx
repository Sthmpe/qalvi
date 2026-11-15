import Link from "next/link";
import { Badge, Card, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { STATUS_COPY } from "@/components/research/InterviewBrowser";
import { listInterviews } from "@/lib/research/results";
import { formatDate } from "@/lib/studies/setup";
export const metadata = { title: "Participants" };
export default async function ParticipantsPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const interviews = await listInterviews(studyId);
  return (
    <>
      <SectionHeading
        title="The people behind the perspectives"
        description="Participants are pseudonymous. Qalvi stores no names or contact details."
      />
      {interviews.length ? (
        <Card className="interview-list">
          {interviews.map((interview) => (
            <Link key={interview.id} href={`/studies/${studyId}/interviews?conversation=${interview.id}`} className="interview-row">
              <span className="participant-avatar">{interview.participant.slice(-2)}</span>
              <div>
                <h3>{interview.participant}</h3>
                <p>Joined through a private link · {interview.messages} {interview.messages === 1 ? "message" : "messages"}</p>
              </div>
              <span className="interview-date">{formatDate(interview.startedAt)}</span>
              <Badge tone={interview.status === "completed" ? "indigo" : "neutral"}>{STATUS_COPY[interview.status]}</Badge>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </Card>
      ) : (
        <EmptyState
          title="Every perspective starts with a person"
          description="No one has joined yet. Each private link from the overview admits one participant."
        />
      )}
    </>
  );
}

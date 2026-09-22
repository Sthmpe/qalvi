import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  SectionHeading,
} from "@/components/ui/primitives";
import { participants, studyConversations } from "@/lib/research/mock-data";
export const metadata = { title: "Participants" };
export default async function ParticipantsPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const people = participants.filter((person) => person.studyId === studyId);
  const interviews = studyConversations(studyId);
  return (
    <>
      <SectionHeading
        title="The people behind the perspectives"
        description="Illustrative participant records. No real identities or contact details are stored."
      />
      {people.length ? (
        <div className="participant-grid">
          {people.map((person) => {
            const conversation = interviews.find(
              (item) => item.participantId === person.id,
            );
            return (
              <Card key={person.id} className="participant-card">
                <span className="participant-avatar">
                  {person.name.slice(-2)}
                </span>
                <h3>{person.name}</h3>
                <p>{person.role}</p>
                <Badge>
                  {conversation ? "Interview complete" : "Invited · sample"}
                </Badge>
                {conversation ? (
                  <Link
                    className="text-link"
                    href={`/studies/${studyId}/interviews?conversation=${conversation.id}`}
                  >
                    Read original messages →
                  </Link>
                ) : (
                  <p className="quiet-note">No conversation evidence yet.</p>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Every perspective starts with a person"
          description="There are no participants in this sample study yet. Participant management will follow in a later milestone."
        />
      )}
    </>
  );
}

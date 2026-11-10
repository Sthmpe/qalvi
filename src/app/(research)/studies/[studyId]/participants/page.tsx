import { EmptyState, SectionHeading } from "@/components/ui/primitives";
import { studyCounts } from "@/lib/studies/queries";
export const metadata = { title: "Participants" };
export default async function ParticipantsPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { participants } = await studyCounts((await params).studyId);
  return (
    <>
      <SectionHeading
        title="The people behind the perspectives"
        description="Participants are pseudonymous. Qalvi stores no names or contact details."
      />
      <EmptyState
        title={participants ? `${participants} ${participants === 1 ? "participant" : "participants"} so far` : "Every perspective starts with a person"}
        description={participants
          ? "Each one joined through a private, single-use link. Participant detail arrives with study results."
          : "No one has joined yet. Each private link from the overview admits one participant."}
      />
    </>
  );
}

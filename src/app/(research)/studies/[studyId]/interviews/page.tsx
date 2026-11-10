import { EmptyState, SectionHeading } from "@/components/ui/primitives";
import { studyCounts } from "@/lib/studies/queries";
export const metadata = { title: "Interviews" };
export default async function InterviewsPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { conversations } = await studyCounts((await params).studyId);
  return (
    <>
      <SectionHeading
        title="Begin with what people actually said"
        description="Every conversation is saved as original, unedited evidence."
      />
      <EmptyState
        title={conversations ? `${conversations} ${conversations === 1 ? "conversation" : "conversations"} saved` : "Room for your first conversation"}
        description={conversations
          ? "Transcripts are stored safely in your workspace. Reading them here arrives with study results, the next milestone."
          : "Make the study active, then invite a participant from the overview. Their conversation will be saved here as original evidence."}
      />
    </>
  );
}

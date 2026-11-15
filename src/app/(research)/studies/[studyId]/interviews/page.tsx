import { notFound } from "next/navigation";
import InterviewBrowser from "@/components/research/InterviewBrowser";
import { EmptyState, SectionHeading } from "@/components/ui/primitives";
import { getInterview, listFindings, listInterviews } from "@/lib/research/results";
import { getStudy } from "@/lib/studies/queries";
export const metadata = { title: "Interviews" };
export default async function InterviewsPage({ params, searchParams }: {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { studyId } = await params;
  const { conversation } = await searchParams;
  const study = await getStudy(studyId);
  if (!study) notFound();
  const interviews = await listInterviews(study.id);
  const heading = (
    <SectionHeading
      title="Begin with what people actually said"
      description="Every conversation is saved as original, unedited evidence."
    />
  );
  if (!interviews.length) {
    return (
      <>
        {heading}
        <EmptyState
          title="Room for your first conversation"
          description="Make the study active, then invite a participant from the overview. Their conversation will appear here as it happens."
        />
      </>
    );
  }
  const selected = await getInterview(study.id, conversation ?? interviews[0].id);
  if (!selected) notFound();
  const cited: Record<string, { id: string; title: string }[]> = {};
  for (const finding of await listFindings(study.id)) {
    for (const quote of finding.evidence) {
      (cited[quote.messageId] ??= []).push({ id: finding.id, title: finding.title });
    }
  }
  return (
    <>
      {heading}
      <InterviewBrowser key={selected.id} studyId={study.id} interviews={interviews} selected={selected}
        objectives={study.objectives} cited={cited} />
    </>
  );
}

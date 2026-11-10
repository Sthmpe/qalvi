import { notFound } from "next/navigation";
import { StudyOverview } from "@/components/research/StudyWorkspace";
import StudyInvitationPanel from "@/components/research/StudyInvitationPanel";
import { getStudy, studyCounts } from "@/lib/studies/queries";
import { readinessGaps } from "@/lib/studies/setup";
export default async function StudyPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const study = await getStudy(studyId);
  if (!study) notFound();
  const invitation = study.status === "completed" || study.status === "archived" ? undefined : (
    <StudyInvitationPanel studyId={study.id} active={study.status === "active"} gaps={readinessGaps(study)} />
  );
  return <StudyOverview study={study} counts={await studyCounts(study.id)} invitation={invitation} />;
}

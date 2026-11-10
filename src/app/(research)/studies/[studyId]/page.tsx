import { notFound } from "next/navigation";
import { StudyOverview } from "@/components/research/StudyWorkspace";
import { getStudy, studyCounts } from "@/lib/studies/queries";
export default async function StudyPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const study = await getStudy(studyId);
  if (!study) notFound();
  return <StudyOverview study={study} counts={await studyCounts(study.id)} />;
}

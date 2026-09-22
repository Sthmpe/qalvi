import { notFound } from "next/navigation";
import { getStudy } from "@/lib/research/mock-data";
import { StudyOverview } from "@/components/research/StudyWorkspace";
export default async function StudyPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const study = getStudy((await params).studyId);
  if (!study) notFound();
  return <StudyOverview study={study} />;
}

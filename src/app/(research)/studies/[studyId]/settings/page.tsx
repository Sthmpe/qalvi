import { notFound } from "next/navigation";
import StudyEditor from "@/components/research/StudyEditor";
import { getStudy } from "@/lib/studies/queries";
export const metadata = { title: "Study setup" };
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const study = await getStudy((await params).studyId);
  if (!study) notFound();
  return <StudyEditor key={study.updatedAt} study={study} />;
}

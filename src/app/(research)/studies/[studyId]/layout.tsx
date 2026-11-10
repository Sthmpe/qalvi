import { notFound } from "next/navigation";
import { StudyWorkspace } from "@/components/research/StudyWorkspace";
import { getStudy } from "@/lib/studies/queries";
export default async function StudyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ studyId: string }>;
}) {
  const study = await getStudy((await params).studyId);
  if (!study) notFound();
  return <StudyWorkspace study={study}>{children}</StudyWorkspace>;
}

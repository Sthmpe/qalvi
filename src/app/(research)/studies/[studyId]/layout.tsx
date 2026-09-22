import { notFound } from "next/navigation";
import { getStudy } from "@/lib/research/mock-data";
import { StudyWorkspace } from "@/components/research/StudyWorkspace";
export default async function StudyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ studyId: string }>;
}) {
  const study = getStudy((await params).studyId);
  if (!study) notFound();
  return <StudyWorkspace study={study}>{children}</StudyWorkspace>;
}

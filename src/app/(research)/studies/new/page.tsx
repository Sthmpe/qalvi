import StudyEditor from "@/components/research/StudyEditor";
export const metadata = { title: "New study" };
export default async function NewStudyPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  return <StudyEditor key={template} templateId={template} />;
}

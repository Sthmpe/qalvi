import StudyDraft from "@/components/research/StudyDraft";
export const metadata = { title: "New study preview" };
export default async function NewStudyPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  return <StudyDraft key={template} templateId={template} />;
}

import EvidenceBrowser from "@/components/research/EvidenceBrowser";
export const metadata = { title: "Interview evidence" };
export default async function InterviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { studyId } = await params;
  const { conversation } = await searchParams;
  return (
    <EvidenceBrowser
      key={studyId + (conversation ?? "")}
      studyId={studyId}
      selectedId={conversation}
    />
  );
}

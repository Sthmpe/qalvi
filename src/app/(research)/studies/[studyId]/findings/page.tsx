import { EmptyState, SectionHeading } from "@/components/ui/primitives";
import { studyFindings } from "@/lib/research/mock-data";
import { FindingCard } from "@/components/research/StudyWorkspace";
export const metadata = { title: "Findings" };
export default async function FindingsPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const derived = studyFindings((await params).studyId);
  return (
    <>
      <SectionHeading
        title="Understanding, with a source"
        description="These hand-authored sample findings are derived interpretations. Inspect the original messages before drawing conclusions."
      />
      <div className="finding-grid">
        {derived.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </div>
      {!derived.length && (
        <EmptyState
          title="Evidence before conclusions"
          description="No findings yet. AI findings generation is not part of this preview."
        />
      )}
    </>
  );
}

import Link from "next/link";
import FindingReview from "@/components/research/FindingReview";
import { Badge, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { CATEGORY_LABEL } from "@/lib/research/analysisShape";
import { listFindings } from "@/lib/research/results";
export const metadata = { title: "Findings" };
export default async function FindingsPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const findings = await listFindings(studyId);
  return (
    <>
      <SectionHeading
        title="Understanding, with a source"
        description="Findings are interpretations. Each one shows the original messages it rests on, so you can judge it yourself."
      />
      {findings.length ? (
        <div className="finding-list">
          {findings.map((finding) => (
            <article key={finding.id} id={`f-${finding.id}`} className="q-card finding-card">
              <div className="finding-tags">
                <Badge tone="indigo">{CATEGORY_LABEL[finding.category]}</Badge>
                <Badge>{finding.origin === "ai" ? "AI interpretation" : "Researcher finding"}</Badge>
                <Badge>{finding.status === "accepted" ? "Accepted" : "Proposed, not reviewed"}</Badge>
              </div>
              <h3>{finding.title}</h3>
              {finding.summary && <p>{finding.summary}</p>}
              <div className="finding-evidence">
                {finding.evidence.map((quote) => (
                  <figure key={`${quote.messageId}-${quote.relation}`} className={quote.relation}>
                    <figcaption>
                      {quote.relation === "supports" ? "Supporting evidence" : "Evidence against"} ·{" "}
                      {quote.speaker === "participant" ? quote.participant : "Qalvi"}
                    </figcaption>
                    <blockquote>{quote.content}</blockquote>
                    <Link className="text-link" href={`/studies/${studyId}/interviews?conversation=${quote.conversationId}#m-${quote.messageId}`}>
                      Read in the transcript ↗
                    </Link>
                  </figure>
                ))}
              </div>
              <FindingReview studyId={studyId} findingId={finding.id} accepted={finding.status === "accepted"} />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Evidence before conclusions"
          description="No findings yet. Open an interview and choose Analyse interview to propose findings linked to what the participant said."
          action={<Link className="q-button q-button--secondary" href={`/studies/${studyId}/interviews`}>Go to interviews</Link>}
        />
      )}
    </>
  );
}

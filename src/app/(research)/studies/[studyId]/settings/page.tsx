import { notFound } from "next/navigation";
import { Badge, Card, SectionHeading } from "@/components/ui/primitives";
import { getStudy } from "@/lib/research/mock-data";
export const metadata = { title: "Study settings" };
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const study = getStudy((await params).studyId);
  if (!study) notFound();
  return (
    <>
      <SectionHeading
        title="Study details"
        description="A read-only preview. Editing, publishing, and data retention controls will arrive with persisted studies."
      />
      <Card className="settings-card">
        <Badge>Sample configuration</Badge>
        <dl>
          <div>
            <dt>Study name</dt>
            <dd>{study.title}</dd>
          </div>
          <div>
            <dt>Research goal</dt>
            <dd>{study.goal}</dd>
          </div>
          <div>
            <dt>Participants</dt>
            <dd>{study.audience}</dd>
          </div>
          <div>
            <dt>Input modes</dt>
            <dd>Voice and text in one conversation</dd>
          </div>
          <div>
            <dt>Evidence policy</dt>
            <dd>
              Raw interview evidence is the source of truth. Derived findings
              never replace original participant messages.
            </dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>Not connected. Preview data is local and illustrative.</dd>
          </div>
        </dl>
      </Card>
    </>
  );
}

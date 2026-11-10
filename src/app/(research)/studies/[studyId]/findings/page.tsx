import { EmptyState, SectionHeading } from "@/components/ui/primitives";
export const metadata = { title: "Findings" };
export default function FindingsPage() {
  return (
    <>
      <SectionHeading
        title="Understanding, with a source"
        description="Findings are derived interpretations. They will always lead back to the original messages."
      />
      <EmptyState
        title="Evidence before conclusions"
        description="Findings arrive with study results, once there are conversations to learn from."
      />
    </>
  );
}

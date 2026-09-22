import { ButtonLink, EmptyState } from "@/components/ui/primitives";

export default function ResearchNotFound() {
  return (
    <EmptyState
      title="This study isn't in the preview"
      description="Choose one of the sample studies to explore the research workspace."
      action={<ButtonLink href="/studies">Explore studies</ButtonLink>}
    />
  );
}

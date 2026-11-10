import { ButtonLink, EmptyState } from "@/components/ui/primitives";

export default function ResearchNotFound() {
  return (
    <EmptyState
      title="We couldn’t find that study"
      description="It may have moved, or it belongs to another workspace. Choose a study from your library."
      action={<ButtonLink href="/studies">Explore studies</ButtonLink>}
    />
  );
}

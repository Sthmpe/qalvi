import { setUpWorkspace } from "@/lib/auth/actions";
import { Card } from "@/components/ui/primitives";

/** Shown only when a signed-in researcher has no workspace yet. Creation is an explicit action. */
export default function WorkspaceSetup() {
  return (
    <Card className="workspace-setup">
      <p className="q-eyebrow">ONE MORE STEP</p>
      <h1>Set up your workspace</h1>
      <p>Your studies and conversations will live here. You can rename it later.</p>
      <form action={setUpWorkspace}>
        <button type="submit" className="q-button q-button--primary">
          Create my workspace
        </button>
      </form>
    </Card>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ResearchShell from "@/components/research/ResearchShell";
import WorkspaceSetup from "@/components/research/WorkspaceSetup";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { getResearcher } from "@/lib/auth/session";
import { findWorkspace } from "@/lib/auth/workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "./research.css";
export const metadata: Metadata = {
  title: { default: "Qalvi: Research workspace", template: "%s · Qalvi" },
  description:
    "Structured conversations. Original evidence. Better understanding.",
};
export default async function ResearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The proxy already redirects signed-out visitors; this is the authoritative check.
  const researcher = await getResearcher();
  if (!researcher) redirect(SIGN_IN_PATH);
  const workspace = await findWorkspace(await createSupabaseServerClient(), researcher.id);
  return (
    <ResearchShell account={{ email: researcher.email, workspace: workspace?.name ?? null }}>
      {workspace ? children : <WorkspaceSetup />}
    </ResearchShell>
  );
}

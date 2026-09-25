import StudyLibrary from "@/components/research/StudyLibrary";
import LiveInvitationPanel from "@/components/research/LiveInvitationPanel";
import { getResearcher } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const metadata = { title: "Studies" };
export default async function StudiesPage() {
  const researcher = await getResearcher();
  const supabase = await createSupabaseServerClient();
  const { data } = researcher ? await supabase.from("studies")
    .select("id, title").eq("status", "active").order("created_at", { ascending: false }) : { data: null };
  return <><StudyLibrary /><LiveInvitationPanel studies={data ?? []} /></>;
}

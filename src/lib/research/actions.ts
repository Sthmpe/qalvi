"use server";

import { revalidatePath } from "next/cache";
import { getResearcher } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept or dismiss a finding. Row level security limits this to the researcher's workspace. */
export async function reviewFinding(studyId: string, findingId: string, decision: "accepted" | "rejected") {
  if (!UUID.test(studyId) || !UUID.test(findingId) || !["accepted", "rejected"].includes(decision)) return { ok: false };
  if (!(await getResearcher())) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("findings").update({ status: decision })
    .eq("id", findingId).eq("study_id", studyId).select("id").maybeSingle();
  if (error || !data) return { ok: false };
  revalidatePath(`/studies/${studyId}`, "layout");
  return { ok: true };
}

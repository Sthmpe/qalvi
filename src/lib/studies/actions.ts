"use server";

import { revalidatePath } from "next/cache";
import { getResearcher } from "@/lib/auth/session";
import { findWorkspace } from "@/lib/auth/workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setupColumns, validateStudySetup, type SetupErrors } from "./setup";

export type SaveStudyResult = { ok: true; id: string } | { ok: false; errors: SetupErrors; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create (id null) or update a study as the signed-in researcher. The setup is
 * validated here, again by database checks, and written through the
 * researcher's own row level security session: a study in another workspace
 * simply matches no row.
 */
export async function saveStudy(id: string | null, input: unknown): Promise<SaveStudyResult> {
  const researcher = await getResearcher();
  if (!researcher) return { ok: false, errors: {}, message: "Your session has ended. Sign in again to save." };
  if (id !== null && !UUID.test(id)) return { ok: false, errors: {}, message: "This study could not be found." };
  const checked = validateStudySetup(input);
  if (!checked.ok) return { ok: false, errors: checked.errors, message: "A few details need attention." };

  const supabase = await createSupabaseServerClient();
  const columns = setupColumns(checked.value);
  let savedId: string | null = null;
  if (id === null) {
    const workspace = await findWorkspace(supabase, researcher.id).catch(() => null);
    if (!workspace) return { ok: false, errors: {}, message: "Set up your workspace before creating a study." };
    const { data, error } = await supabase.from("studies")
      .insert({ ...columns, workspace_id: workspace.id }).select("id").single();
    if (!error) savedId = data.id;
  } else {
    const { data, error } = await supabase.from("studies").update(columns).eq("id", id).select("id").maybeSingle();
    if (!error && data) savedId = data.id;
    if (!error && !data) return { ok: false, errors: {}, message: "This study could not be found." };
  }
  if (!savedId) return { ok: false, errors: {}, message: "The study could not be saved. Please try again." };

  revalidatePath("/dashboard");
  revalidatePath("/studies");
  revalidatePath(`/studies/${savedId}`, "layout");
  return { ok: true, id: savedId };
}

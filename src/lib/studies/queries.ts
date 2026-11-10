import "server-only";
import { cache } from "react";
import { getResearcher } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { studyFromRow, type Study } from "./setup";

const COLUMNS = "id, title, description, research_goal, audience, category, status, objectives, assumptions, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StudyCounts = { conversations: number; participants: number; findings: number };
export type StudySummary = Study & { conversations: number };

/** Every study the signed-in researcher can see. Row level security limits this to their workspaces. */
export const listStudies = cache(async (): Promise<StudySummary[]> => {
  if (!(await getResearcher())) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("studies")
    .select(`${COLUMNS}, conversations(count)`)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Studies could not be loaded.");
  return (data ?? []).map((row) => ({
    ...studyFromRow(row),
    conversations: row.conversations?.[0]?.count ?? 0,
  }));
});

/** One study, or null when it does not exist or belongs to another workspace. */
export const getStudy = cache(async (id: string): Promise<Study | null> => {
  if (!UUID.test(id) || !(await getResearcher())) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("studies").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("This study could not be loaded.");
  return data ? studyFromRow(data) : null;
});

async function count(table: "conversations" | "participants" | "findings", studyId?: string) {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (studyId) query = query.eq("study_id", studyId);
  const { count: total, error } = await query;
  if (error) throw new Error("Research counts could not be loaded.");
  return total ?? 0;
}

/** Real counts from saved evidence. Nothing here is derived or estimated. */
export const studyCounts = cache(async (studyId?: string): Promise<StudyCounts> => {
  if (!(await getResearcher())) return { conversations: 0, participants: 0, findings: 0 };
  const [conversations, participants, findings] = await Promise.all([
    count("conversations", studyId), count("participants", studyId), count("findings", studyId),
  ]);
  return { conversations, participants, findings };
});

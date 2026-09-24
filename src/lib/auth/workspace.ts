import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { firstWorkspaceName } from "./routes";

type Client = SupabaseClient<Database>;
export type Workspace = { id: string; name: string; role: string };

/** The researcher's first workspace, read through their own row level security. */
export async function findWorkspace(supabase: Client, userId: string): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, created_at, workspaces (id, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.workspaces) return null;
  return { id: data.workspaces.id, name: data.workspaces.name, role: data.role };
}

/**
 * Return the researcher's workspace, creating their first one only if they have
 * none. Called once per sign-in (or from an explicit setup button), never from
 * a render, so page loads and prefetches cannot race each other into duplicates.
 */
export async function ensureWorkspace(supabase: Client, userId: string): Promise<Workspace> {
  const existing = await findWorkspace(supabase, userId);
  if (existing) return existing;

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const name = firstWorkspaceName(profile?.display_name);
  const { data: id, error } = await supabase.rpc("create_workspace", { workspace_name: name });
  if (error) throw error;
  return { id, name, role: "owner" };
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabasePublicConfig } from "./config";

/**
 * Elevated Supabase client for trusted server code only. It bypasses row level
 * security, but not the database's integrity rules: it still cannot rewrite
 * evidence or save an unsupported finding. `server-only` makes importing it from
 * client code a build error, so the secret key never reaches a browser.
 *
 * Stage 2B.2 uses it only for invitation metadata and the narrow claim/resume
 * RPCs. Researcher authorization still happens through their own RLS client.
 */
export function createSupabaseSecretClient() {
  const { url } = supabasePublicConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey?.startsWith("sb_secret_")) {
    throw new Error("Supabase elevated access requires a server-side Supabase secret key.");
  }
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

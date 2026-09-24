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
 * Nothing uses it yet. Researchers act through their own session, and live
 * interview persistence (M4 Stage 2B) will decide how evidence is written.
 */
export function createSupabaseSecretClient() {
  const { url } = supabasePublicConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Supabase elevated access is not configured. Set SUPABASE_SECRET_KEY on the server.");
  }
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

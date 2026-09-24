import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { supabasePublicConfig } from "./config";

/** Supabase client for Client Components, acting as the signed-in researcher. */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = supabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey);
}

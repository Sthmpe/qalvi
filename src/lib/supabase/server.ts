import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { supabasePublicConfig } from "./config";

/**
 * Supabase client for Server Components, Server Functions, and Route Handlers,
 * acting as the signed-in researcher. Row level security applies to every query.
 */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = supabasePublicConfig();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. The proxy has already refreshed
          // the session for this request, so nothing is lost.
        }
      },
    },
  });
}

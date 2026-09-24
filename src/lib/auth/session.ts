import "server-only";
import { cache } from "react";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Researcher = { id: string; email: string | null };

/**
 * The signed-in researcher, or null. Identity comes from `getClaims()`, which
 * verifies the access token's signature; the cookie session is never trusted
 * on its own. Anonymous Supabase sessions are not researchers.
 */
export const getResearcher = cache(async (): Promise<Researcher | null> => {
  if (!supabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || claims.is_anonymous) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

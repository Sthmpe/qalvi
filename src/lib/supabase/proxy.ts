import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { supabasePublicConfig } from "./config";

/**
 * Refresh the researcher's session for this request and report who they are.
 * `getClaims()` verifies the access token (refreshing it first if it is about to
 * expire), and any new cookies are written to both the request, for the pages
 * rendered next, and the response, for the browser.
 */
export async function refreshSession(request: NextRequest) {
  const { url, publishableKey } = supabasePublicConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const signedIn = Boolean(!error && claims?.sub && !claims.is_anonymous);
  return { response, signedIn };
}

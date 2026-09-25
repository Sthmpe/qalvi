import { NextResponse, type NextRequest } from "next/server";
import { HOME_PATH, SIGN_IN_PATH, isResearcherPath, safeNext, signInPathFor } from "@/lib/auth/routes";
import { supabaseConfigured } from "@/lib/supabase/config";
import { refreshSession } from "@/lib/supabase/proxy";

// Researcher routes only. Participants use a separate invitation and HTTP-only
// resume capability; the proxy must never treat them as researcher Auth users.
export const config = {
  matcher: ["/", "/dashboard/:path*", "/studies/:path*", "/sign-in"],
};

function redirectTo(request: NextRequest, path: string, from?: NextResponse) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  // Keep any refreshed session cookies on the redirect.
  for (const cookie of from?.cookies.getAll() ?? []) redirect.cookies.set(cookie);
  return redirect;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const protectedPath = isResearcherPath(pathname);

  // Fail closed: without configuration nobody is signed in, and the sign-in
  // page explains that sign in is unavailable.
  if (!supabaseConfigured()) {
    return protectedPath ? redirectTo(request, signInPathFor(pathname, search)) : NextResponse.next();
  }

  const session = await refreshSession(request);
  const { response } = session;
  if (protectedPath && !session.signedIn) return redirectTo(request, signInPathFor(pathname, search), response);
  if (pathname === SIGN_IN_PATH && session.signedIn) {
    return redirectTo(request, safeNext(request.nextUrl.searchParams.get("next") ?? HOME_PATH), response);
  }
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { claimInvitation, JOINED_COOKIE, participantCookieOptions, RESUME_COOKIE, sameOrigin } from "@/lib/interview/gateway";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse("Invalid request origin.", { status: 403 });
  const form = await request.formData().catch(() => null);
  if (!form || form.get("consent") !== "yes") {
    return new NextResponse("Please agree to transcript storage before continuing.", { status: 400 });
  }
  const token = form.get("invitation");
  if (typeof token !== "string") return new NextResponse("Invalid invitation.", { status: 400 });
  try {
    const claimed = await claimInvitation(token);
    if (!claimed) return new NextResponse("This invitation is unavailable or has expired.", { status: 410 });
    const response = NextResponse.redirect(new URL("/interview/session", request.url), 303);
    response.cookies.set(RESUME_COOKIE, claimed.resume, participantCookieOptions());
    response.cookies.set(JOINED_COOKIE, "", { ...participantCookieOptions(), maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return new NextResponse("The interview could not be started. Please try again.", { status: 503 });
  }
}

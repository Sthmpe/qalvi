import { NextRequest, NextResponse } from "next/server";
import { JOINED_COOKIE, participantCookieOptions, RESUME_COOKIE, resolveParticipant, sameOrigin } from "@/lib/interview/gateway";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const session = await resolveParticipant(request.cookies.get(RESUME_COOKIE)?.value).catch(() => null);
  if (!session) return new NextResponse(null, { status: 401 });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(JOINED_COOKIE, "1", participantCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}

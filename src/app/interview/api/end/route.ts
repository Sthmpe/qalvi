import { NextRequest, NextResponse } from "next/server";
import { RESUME_COOKIE, sameOrigin } from "@/lib/interview/gateway";
import { readParticipantRecovery } from "@/lib/interview/recovery";
import { endInterview } from "@/lib/interview/lifecycle";
import { terminalInterview } from "@/components/interview/recovery";

function reply(body: Record<string, unknown>, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * The participant chooses to end their interview. Idempotent: ending an
 * already-ended interview returns its existing status. The capability stays
 * readable for the transcript, but no token, write or claim is possible after.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ code: "invalid_origin", error: "Invalid request origin." }, 403);
  let snapshot;
  try { snapshot = await readParticipantRecovery(request.cookies.get(RESUME_COOKIE)?.value, -1, 1); }
  catch { return reply({ code: "end_unavailable", error: "The interview could not be ended right now." }, 503); }
  if (!snapshot) return reply({ code: "session_unavailable", error: "Interview session expired or ended." }, 401);
  if (terminalInterview(snapshot.status)) {
    return reply({ status: snapshot.status, endReason: snapshot.endReason ?? null }, 200);
  }
  try {
    const status = await endInterview(snapshot.sessionKey, "completed", "participant_ended");
    // A concurrent researcher cancellation may have won; report what the database recorded.
    const after = await readParticipantRecovery(request.cookies.get(RESUME_COOKIE)?.value, -1, 1);
    return reply({ status: after?.status ?? status, endReason: after?.endReason ?? null }, 200);
  } catch {
    return reply({ code: "end_unavailable", error: "The interview could not be ended right now." }, 503);
  }
}

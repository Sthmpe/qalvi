import { NextRequest, NextResponse } from "next/server";
import { RESUME_COOKIE, resolveParticipant, sameOrigin } from "@/lib/interview/gateway";
import { ensureInterviewWriter } from "@/lib/interview/lifecycle";

function reply(body: Record<string, unknown>, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (status === 202) response.headers.set("Retry-After", "2");
  return response;
}

/**
 * The participant's interviewer disappeared while the room stayed up. The
 * server, not the browser, decides whether the writer is really lost (its lease
 * lapsed or was released) and, if so, dispatches one fenced replacement into the
 * same room and project. Polling is safe: repeated calls never dispatch twice.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ code: "invalid_origin", error: "Invalid request origin." }, 403);
  const session = await resolveParticipant(request.cookies.get(RESUME_COOKIE)?.value).catch(() => null);
  if (!session) return reply({ state: "unavailable", code: "session_unavailable",
    error: "Interview session expired or ended." }, 401);
  if (process.env.LIVEKIT_PROFILE_IDS === undefined) {
    return reply({ state: "unavailable", code: "recovery_unsupported",
      error: "Interviewer recovery requires named LiveKit profiles." }, 501);
  }
  if (session.writer_generation === 0) {
    return reply({ state: "preparing", code: "not_started",
      error: "The interview has not started yet; keep connecting." }, 409);
  }
  try {
    const state = await ensureInterviewWriter(session.id);
    if (state === "active") return reply({ state }, 200);
    if (state === "recovering") return reply({ state }, 202);
    if (state === "terminal") return reply({ state, code: "session_ended", error: "This interview has ended." }, 410);
    if (state === "exhausted") return reply({ state, code: "recovery_unavailable",
      error: "The interviewer could not be restored. Your conversation is saved." }, 503);
    return reply({ state, code: "not_recoverable", error: "This interview cannot be resumed now." }, 409);
  } catch {
    return reply({ state: "unavailable", code: "recovery_error",
      error: "Interviewer recovery is temporarily unavailable. Your conversation is saved." }, 503);
  }
}

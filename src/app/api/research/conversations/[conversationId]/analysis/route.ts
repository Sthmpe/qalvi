import { NextRequest, NextResponse } from "next/server";
import { getResearcher } from "@/lib/auth/session";
import { sameOrigin } from "@/lib/interview/gateway";
import { analyseConversation } from "@/lib/research/analysis";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_STATUS = { completed: 200, busy: 409, empty: 422, not_found: 404, unconfigured: 503, failed: 502 } as const;

/** A researcher asks for one bounded analysis of one saved interview. Retrying is always safe. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const reply = (body: Record<string, unknown>, status: number) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!sameOrigin(request)) return reply({ error: "Invalid request origin." }, 403);
  if (!(await getResearcher())) return reply({ error: "Sign in to analyse interviews." }, 401);
  const { conversationId } = await params;
  if (!UUID.test(conversationId)) return reply({ error: "Interview not found." }, 404);
  try {
    const outcome = await analyseConversation(conversationId, await createSupabaseServerClient());
    return outcome.status === "completed"
      ? reply({ status: outcome.status, findings: outcome.findings }, 200)
      : reply({ status: outcome.status, error: outcome.message }, HTTP_STATUS[outcome.status]);
  } catch {
    return reply({ status: "failed", error: "Analysis is unavailable right now." }, 503);
  }
}

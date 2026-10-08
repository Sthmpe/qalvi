import { NextRequest, NextResponse } from "next/server";
import { getResearcher } from "@/lib/auth/session";
import { sameOrigin } from "@/lib/interview/gateway";
import { endInterview } from "@/lib/interview/lifecycle";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: Record<string, unknown>, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * A researcher cancels one interview. Authorization is the researcher's own
 * verified session and RLS view of the conversation; the elevated client is used
 * only for the idempotent terminal transition and the participant's ejection.
 */
export async function POST(request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }) {
  if (!sameOrigin(request)) return reply({ code: "invalid_origin", error: "Invalid request origin." }, 403);
  const researcher = await getResearcher();
  if (!researcher) return reply({ code: "unauthenticated", error: "Sign in to manage interviews." }, 401);
  const { conversationId } = await params;
  if (!UUID.test(conversationId)) return reply({ code: "not_found", error: "Interview not found." }, 404);
  const supabase = await createSupabaseServerClient();
  const { data: visible, error } = await supabase.from("conversations")
    .select("id").eq("id", conversationId).maybeSingle();
  if (error) return reply({ code: "cancel_unavailable", error: "The interview could not be cancelled right now." }, 503);
  if (!visible) return reply({ code: "not_found", error: "Interview not found." }, 404);
  try {
    const status = await endInterview(conversationId, "cancelled", "researcher_cancelled");
    return reply({ status }, 200);
  } catch {
    return reply({ code: "cancel_unavailable", error: "The interview could not be cancelled right now." }, 503);
  }
}

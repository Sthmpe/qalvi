import { NextRequest, NextResponse } from "next/server";
import { getResearcher } from "@/lib/auth/session";
import { issueInvitation, sameOrigin } from "@/lib/interview/gateway";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, context: { params: Promise<{ studyId: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const researcher = await getResearcher();
  if (!researcher) return NextResponse.json({ error: "Sign in to create an invitation." }, { status: 401 });
  try {
    const { studyId } = await context.params;
    const invitation = await issueInvitation(studyId, researcher.id, await createSupabaseServerClient());
    if (!invitation) return NextResponse.json({ error: "This study is unavailable for interviewing." }, { status: 404 });
    const response = NextResponse.json({
      url: new URL(`/interview/invite/${invitation.token}`, request.url).toString(),
      expiresAt: invitation.expiresAt,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return NextResponse.json({ error: "Invitation service is unavailable." }, { status: 503 });
  }
}

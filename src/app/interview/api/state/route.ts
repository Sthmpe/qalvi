import { NextRequest, NextResponse } from "next/server";
import { RESUME_COOKIE } from "@/lib/interview/gateway";
import { readParticipantRecovery } from "@/lib/interview/recovery";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("afterSequence");
  const after = raw === null ? -1 : Number(raw);
  if (!Number.isInteger(after) || after < -1) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  let snapshot;
  try { snapshot = await readParticipantRecovery(request.cookies.get(RESUME_COOKIE)?.value, after); }
  catch { return NextResponse.json({ error: "Interview recovery is unavailable." }, { status: 503 }); }
  if (!snapshot) return NextResponse.json({ error: "Interview session is unavailable." }, { status: 401 });
  const response = NextResponse.json(snapshot);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

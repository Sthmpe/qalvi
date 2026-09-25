import { NextRequest, NextResponse } from "next/server";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { JOINED_COOKIE, RESUME_COOKIE, resolveParticipant, sameOrigin } from "@/lib/interview/gateway";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await resolveParticipant(request.cookies.get(RESUME_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: "Interview session expired or ended." }, { status: 401 });
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !serverUrl) {
    return NextResponse.json({ error: "Interview connection is unavailable." }, { status: 503 });
  }
  const identity = `participant-${session.participant_id}`;
  const token = new AccessToken(apiKey, apiSecret, {
    identity, ttl: "5m",
    attributes: { "qalvi.resume": request.cookies.get(JOINED_COOKIE)?.value === "1" ? "true" : "false" },
  });
  token.addGrant({
    roomJoin: true, room: session.livekit_room!,
    canPublishSources: [TrackSource.MICROPHONE], canPublishData: true,
    canSubscribe: true, canUpdateOwnMetadata: false,
  });
  const response = NextResponse.json({ serverUrl, token: await token.toJwt(),
    roomName: session.livekit_room, identity });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

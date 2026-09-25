import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

/**
 * Mints a short-lived LiveKit room-join token for the participant browser.
 *
 * LiveKit credentials remain server-side here and in the real interview token
 * route. LIVEKIT_API_SECRET never reaches a browser (AGENTS.md rule 15).
 *
 * Public demo only. Real interviews use /interview/api/token, which resolves
 * a server-side conversation from a secure resume cookie.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !serverUrl) {
    return NextResponse.json(
      { error: "LiveKit is not configured on the server." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const roomName = typeof body.roomName === "string" && /^qalvi-demo-[0-9a-f-]{36}$/.test(body.roomName)
    ? body.roomName : `qalvi-demo-${crypto.randomUUID()}`;
  const identity = typeof body.identity === "string" && /^participant-[0-9a-f-]{36}$/.test(body.identity)
    ? body.identity : `participant-${crypto.randomUUID()}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: "15m",
    // A replacement agent must not greet as if this were a fresh interview.
    attributes: { "qalvi.resume": body.resume === true ? "true" : "false" },
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  return NextResponse.json({
    serverUrl,
    token: await token.toJwt(),
    roomName,
    identity,
  });
}

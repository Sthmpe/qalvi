import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

/**
 * Mints a short-lived LiveKit room-join token for the participant browser.
 *
 * This is the ONLY place LiveKit credentials are touched — LIVEKIT_API_KEY
 * and LIVEKIT_API_SECRET never leave the server (AGENTS.md rule 15).
 *
 * Milestone 2 proof-of-concept: any caller gets a token for a fresh,
 * randomly-named room. There is no study/auth model yet (Milestone 4/5).
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
  const roomName = typeof body.roomName === "string" ? body.roomName : `qalvi-demo-${Date.now()}`;
  const identity =
    typeof body.identity === "string" ? body.identity : `participant-${Date.now()}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: "15m",
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

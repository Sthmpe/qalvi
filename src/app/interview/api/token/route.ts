import { NextRequest, NextResponse } from "next/server";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { RESUME_COOKIE, readParticipantTransport, resolveParticipant, sameOrigin } from "@/lib/interview/gateway";
import { assignmentTimeoutMs, loadLiveKitProfiles, type LiveKitProfile } from "@/lib/interview/livekitProfiles";
import { LiveKitProviderFailure } from "@/lib/interview/livekitFailures";
import { routeLiveKitTransport, type TransportState, type TransportStore } from "@/lib/interview/livekitRouter";

export const maxDuration = 150;

function storeFor(conversationId: string): TransportStore {
  const admin = createSupabaseSecretClient();
  const read = () => readParticipantTransport(conversationId, admin) as Promise<TransportState>;
  return {
    read,
    async reserve(state, nonce, leaseSeconds) {
      const { data, error } = await admin.rpc("reserve_interview_transport", {
        p_conversation_id: conversationId, p_profile_id: state.livekit_profile_id,
        p_generation: state.transport_generation, p_nonce: nonce, p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error("Interview transport reservation failed.");
      return data;
    },
    async confirm(state, nonce) {
      const { data, error } = await admin.rpc("confirm_interview_transport", {
        p_conversation_id: conversationId, p_profile_id: state.livekit_profile_id,
        p_generation: state.transport_generation, p_nonce: nonce,
      });
      if (error) throw new Error("Interview transport confirmation failed.");
      return data;
    },
    async rotate(state, nonce, next, room, reason) {
      const { data, error } = await admin.rpc("rotate_interview_transport", {
        p_conversation_id: conversationId, p_profile_id: state.livekit_profile_id,
        p_generation: state.transport_generation, p_room: state.livekit_room,
        p_nonce: nonce, p_next_profile_id: next.id, p_next_room: room, p_reason: reason,
      });
      if (error || data !== state.transport_generation + 1) throw new Error("Interview transport rotation failed.");
    },
    async fail(state, nonce, reason) {
      const { data, error } = await admin.rpc("fail_interview_transport", {
        p_conversation_id: conversationId, p_profile_id: state.livekit_profile_id,
        p_generation: state.transport_generation, p_nonce: nonce, p_reason: reason,
      });
      if (error || !data) throw new Error("Interview transport failure could not be recorded.");
    },
  };
}

async function participantToken(profile: LiveKitProfile, room: string, participantId: string,
  writerGeneration: number, transportGeneration?: number) {
  const identity = `participant-${participantId}`;
  const token = new AccessToken(profile.apiKey, profile.apiSecret, {
    identity, ttl: "5m",
    attributes: { "qalvi.resume": writerGeneration > 0 ? "true" : "false" },
  });
  token.addGrant({
    roomJoin: true, room,
    canPublishSources: [TrackSource.MICROPHONE], canPublishData: true,
    canSubscribe: true, canUpdateOwnMetadata: false,
  });
  const response = NextResponse.json({ serverUrl: profile.serverUrl, token: await token.toJwt(),
    roomName: room, identity, ...(transportGeneration ? { transportGeneration } : {}) });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await resolveParticipant(request.cookies.get(RESUME_COOKIE)?.value).catch(() => null);
  if (!session) return NextResponse.json({ error: "Interview session expired or ended." }, { status: 401 });
  try {
    const profiles = loadLiveKitProfiles();
    if (!profiles.length) throw new LiveKitProviderFailure("transport_unavailable");
    // Existing deployments without LIVEKIT_PROFILE_IDS use the exact previous
    // unnamed/automatic-dispatch path and do not depend on the new migration.
    if (process.env.LIVEKIT_PROFILE_IDS === undefined) {
      return participantToken(profiles[0], session.livekit_room!, session.participant_id,
        session.writer_generation);
    }
    const enabled = profiles.filter((profile) => profile.enabled);
    if (!enabled.length) throw new LiveKitProviderFailure("transport_unavailable");
    const body = await request.json().catch(() => null) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid connection request." }, { status: 400 });
    }
    const report = body as Record<string, unknown>;
    if ("failedTransportGeneration" in report || "failureEventId" in report) {
      if (!Number.isSafeInteger(report.failedTransportGeneration) ||
          typeof report.failedTransportGeneration !== "number" ||
          report.failedTransportGeneration < 1 || typeof report.failureEventId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(report.failureEventId)) {
        return NextResponse.json({ error: "Invalid connection report." }, { status: 400 });
      }
      // The cookie determines the conversation; the RPC verifies pending
      // state, generation and durable absence of evidence, then deduplicates
      // this failure event. A browser never chooses a backup project.
      const { error } = await createSupabaseSecretClient().rpc("report_interview_transport_connection_failure", {
        p_conversation_id: session.id, p_generation: report.failedTransportGeneration,
        p_event_id: report.failureEventId,
      });
      if (error) {
        const latest = await readParticipantTransport(session.id);
        // Another request may already have rotated or started the session.
        // Ignore that old report; it must never block a replacement token.
        if (latest.transport_generation === report.failedTransportGeneration) {
          return NextResponse.json({ error: "Connection report could not be accepted." }, { status: 409 });
        }
      }
    }
    const routed = await routeLiveKitTransport(profiles, storeFor(session.id), assignmentTimeoutMs());
    if (routed.kind === "retry") {
      const response = NextResponse.json({ status: "preparing" }, { status: 202 });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Retry-After", "1");
      return response;
    }
    return participantToken(routed.profile, routed.state.livekit_room, session.participant_id,
      routed.state.writer_generation, routed.state.transport_generation);
  } catch (error) {
    const unavailable = error instanceof LiveKitProviderFailure;
    return NextResponse.json({ code: unavailable ? "transport_unavailable" : "connection_error", error: unavailable
      ? "Interview transport is temporarily unavailable. Your conversation is saved."
      : "Interview connection could not be prepared." }, { status: unavailable ? 503 : 500 });
  }
}

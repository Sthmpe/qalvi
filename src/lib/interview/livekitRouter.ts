import "server-only";
import { randomUUID } from "node:crypto";
import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import type { LiveKitProfile } from "./livekitProfiles";
import { liveKitApiUrl } from "./livekitProfiles";
import { classifyLiveKitFailure, LiveKitProviderFailure, type LiveKitFailureReason } from "./livekitFailures";

export type TransportState = {
  id: string;
  livekit_room: string;
  livekit_profile_id: string;
  transport_generation: number;
  transport_failed_profiles: string[];
  transport_ready_at: string | null;
  transport_failure_reason: string | null;
  transport_connection_failures: number;
  status: string;
  writer_generation: number;
  next_message_sequence: number;
};

export type TransportStore = {
  read: () => Promise<TransportState>;
  reserve: (state: TransportState, nonce: string, leaseSeconds: number) => Promise<boolean>;
  confirm: (state: TransportState, nonce: string) => Promise<boolean>;
  rotate: (state: TransportState, nonce: string, next: LiveKitProfile,
    room: string, reason: LiveKitFailureReason) => Promise<void>;
  fail: (state: TransportState, nonce: string, reason: LiveKitFailureReason) => Promise<void>;
};

export type RoutingResult = { kind: "ready"; profile: LiveKitProfile; state: TransportState } | { kind: "retry" };

/** This is one bounded routing step per HTTP request. A 202 lets the browser retry
 * without a single request waiting across every configured backup project. */
export async function routeLiveKitTransport(
  profiles: LiveKitProfile[], store: TransportStore, timeoutMs: number,
  assign = assignNamedWorker,
): Promise<RoutingResult> {
  if (!profiles.some((profile) => profile.enabled)) {
    throw new LiveKitProviderFailure("transport_unavailable");
  }
  const state = await store.read();
  const current = profiles.find((profile) => profile.id === state.livekit_profile_id);
  if (!current) throw new Error("Interview LiveKit profile is not configured.");
  const blocked = new Set(state.transport_failed_profiles);
  const canRotate = state.status === "pending" && state.writer_generation === 0 &&
    state.next_message_sequence === 0;
  if (!canRotate) {
    if (!current.enabled) throw new LiveKitProviderFailure("profile_disabled");
    return { kind: "ready", profile: current, state };
  }
  // A confirmed assignment is attempted only once for this generation. The
  // browser may report failed WebRTC connects; it cannot trigger redispatch
  // merely by requesting more tokens or waiting for the timestamp to age.
  if (state.transport_ready_at && state.transport_connection_failures < 2) {
    if (current.enabled) {
      return { kind: "ready", profile: current, state };
    }
  }
  if (blocked.has(state.livekit_profile_id) && !profiles.some((profile) =>
    profile.enabled && profile.id !== state.livekit_profile_id && !blocked.has(profile.id))) {
    throw new LiveKitProviderFailure("transport_unavailable");
  }
  const nonce = randomUUID();
  const reserved = await store.reserve(state, nonce, Math.ceil(timeoutMs / 1000) + 60);
  if (!reserved) return { kind: "retry" };

  let failure: LiveKitProviderFailure | null = null;
  if (state.transport_connection_failures >= 2) {
    failure = new LiveKitProviderFailure("transport_unavailable");
  } else if (blocked.has(state.livekit_profile_id)) {
    failure = new LiveKitProviderFailure("transport_unavailable");
  } else if (!current.enabled) {
    failure = new LiveKitProviderFailure("profile_disabled");
  } else {
    try {
      await assign(current, state.livekit_room, timeoutMs);
      if (!await store.confirm(state, nonce)) return { kind: "retry" };
      return { kind: "ready", profile: current,
        state: { ...state, transport_ready_at: new Date().toISOString() } };
    } catch (error) {
      failure = classifyLiveKitFailure(error);
      if (!failure) throw error; // Qalvi/config/auth errors must never cascade.
    }
  }

  const next = profiles.find((profile) => profile.enabled && profile.id !== state.livekit_profile_id &&
    !blocked.has(profile.id));
  if (!next) {
    await store.fail(state, nonce, failure.reason);
    throw new LiveKitProviderFailure(failure.reason);
  }
  await store.rotate(state, nonce, next, `qalvi-real-${randomUUID()}`, failure.reason);
  return { kind: "retry" };
}

/** Named dispatch is only used in explicitly configured profile mode. The
 * legacy singleton keeps its existing unnamed automatic-dispatch behavior. */
export async function assignNamedWorker(profile: LiveKitProfile, roomName: string, timeoutMs: number) {
  if (!profile.agentName) throw new Error("Named LiveKit worker is not configured.");
  const host = liveKitApiUrl(profile);
  const rooms = new RoomServiceClient(host, profile.apiKey, profile.apiSecret);
  const dispatches = new AgentDispatchClient(host, profile.apiKey, profile.apiSecret);
  const existingRooms = await rooms.listRooms([roomName]);
  if (!existingRooms.length) {
    // Agents do not keep a room alive after its last standard participant
    // leaves. Retain the room beyond the worker's 120-second refresh grace.
    try { await rooms.createRoom({ name: roomName, emptyTimeout: 180, departureTimeout: 150 }); }
    catch (error) {
      // Another request may have created it. Do not convert an unrelated 4xx
      // into a failover: prove the room now exists before continuing.
      if (!(await rooms.listRooms([roomName])).length) throw error;
    }
  }
  let matches = (await dispatches.listDispatch(roomName))
    .filter((dispatch) => dispatch.agentName === profile.agentName);
  if (matches.length > 1) throw new Error("Duplicate LiveKit dispatches for interview room.");
  if (!matches.length) {
    const created = await dispatches.createDispatch(roomName, profile.agentName,
      profile.deployment ? { deployment: profile.deployment } : undefined);
    matches = [created];
  }
  const dispatchId = matches[0].id;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let dispatch: Awaited<ReturnType<AgentDispatchClient["getDispatch"]>>;
    try { dispatch = await dispatches.getDispatch(dispatchId, roomName); }
    catch (error) {
      // A dispatch that vanished after creation is a lost provider resource,
      // not a malformed browser request (the browser supplies neither ID).
      if ((error as { status?: unknown }).status === 404) {
        throw new LiveKitProviderFailure("transport_unavailable");
      }
      throw error;
    }
    if (!dispatch) throw new LiveKitProviderFailure("transport_unavailable");
    const jobs = dispatch.state?.jobs ?? [];
    if (jobs.some((job) => job.state?.status === 1 && !!job.state.workerId)) return;
    const failed = jobs.find((job) => job.state?.status === 3);
    if (failed) {
      const classified = classifyLiveKitFailure({ message: failed.state?.error });
      if (classified) throw classified;
      throw new Error("LiveKit worker failed before assignment.");
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new LiveKitProviderFailure("assignment_timeout");
}

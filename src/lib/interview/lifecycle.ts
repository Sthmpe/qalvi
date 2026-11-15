import "server-only";
import { randomUUID } from "node:crypto";
import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { liveKitApiUrl, loadLiveKitProfiles, type LiveKitProfile } from "./livekitProfiles";
import { classifyLiveKitFailure, withProviderDeadline } from "./livekitFailures";

type Client = SupabaseClient<Database>;

/** Rooms Qalvi creates keep the accepted 2B.4A retention: they outlive the
 * worker's 120-second reconnect grace after the last participant leaves. */
export const ROOM_RETENTION = { emptyTimeout: 180, departureTimeout: 150 } as const;
/** One replacement dispatch per window; three consecutive attempts at most. */
export const RECOVERY_WINDOW_SECONDS = 90;

/** Server view of whether a live writer exists for a started interview. */
export type WriterState = "active" | "recovering" | "terminal" | "unavailable" | "exhausted";
export type EndingStatus = "completed" | "cancelled";
export type EndingReason = "participant_ended" | "researcher_cancelled";

export type LiveKitClients = {
  rooms: (profile: LiveKitProfile) => Pick<RoomServiceClient, "listRooms" | "createRoom" | "deleteRoom">;
  dispatches: (profile: LiveKitProfile) =>
    Pick<AgentDispatchClient, "listDispatch" | "createDispatch" | "deleteDispatch">;
};

const liveKit: LiveKitClients = {
  rooms: (profile) => new RoomServiceClient(liveKitApiUrl(profile), profile.apiKey, profile.apiSecret),
  dispatches: (profile) => new AgentDispatchClient(liveKitApiUrl(profile), profile.apiKey, profile.apiSecret),
};

/**
 * Dispatch one fresh named worker into the conversation's CURRENT room, in that
 * room's own LiveKit project. A dispatch whose job already ended cannot start a
 * new job, so it is replaced. A room deleted after its retention window is
 * recreated with the same retention. Does not wait for assignment: the new
 * worker's lease claim is the signal that recovery finished.
 */
export async function dispatchReplacementWorker(profile: LiveKitProfile, room: string, clients = liveKit) {
  if (!profile.agentName) throw new Error("Named LiveKit worker is not configured.");
  const rooms = clients.rooms(profile);
  if (!(await withProviderDeadline(rooms.listRooms([room]))).length) {
    try { await withProviderDeadline(rooms.createRoom({ name: room, ...ROOM_RETENTION })); }
    catch (error) { if (!(await withProviderDeadline(rooms.listRooms([room]))).length) throw error; }
  }
  const dispatches = clients.dispatches(profile);
  for (const existing of await withProviderDeadline(dispatches.listDispatch(room))) {
    if (existing.agentName !== profile.agentName) continue;
    const jobs = existing.state?.jobs ?? [];
    // A pending job is an assignment already in flight: reuse it.
    if (jobs.some((job) => job.state?.status === 0)) return existing.id;
    // A running job belongs to the lapsed writer the database just fenced; it
    // stops at its next heartbeat. Keep it, but still dispatch a replacement.
    if (jobs.some((job) => job.state?.status === 1)) continue;
    // An ended or jobless dispatch can never start a new job.
    await withProviderDeadline(dispatches.deleteDispatch(existing.id, room)).catch(() => undefined);
  }
  const created = await withProviderDeadline(dispatches.createDispatch(room, profile.agentName,
    profile.deployment ? { deployment: profile.deployment } : undefined));
  return created.id;
}

type ConversationTransport = {
  livekit_profile_id: string; livekit_room: string | null; status: string; writer_generation: number;
};

/**
 * Make sure a started, writable interview has a live writer. Only a lapsed or
 * released lease leads to a replacement, and the database reservation both
 * fences the lapsed writer and lets exactly one request dispatch per window.
 */
export async function ensureInterviewWriter(conversationId: string, options: {
  admin?: Client; profiles?: LiveKitProfile[]; clients?: LiveKitClients;
} = {}): Promise<WriterState> {
  const admin = options.admin ?? createSupabaseSecretClient();
  const { data: reservation, error } = await admin.rpc("reserve_interview_writer_recovery", {
    p_conversation_id: conversationId, p_nonce: randomUUID(), p_window_seconds: RECOVERY_WINDOW_SECONDS,
  });
  if (error) throw new Error("Interview recovery could not be reserved.");
  if (reservation !== "reserved") return reservation as WriterState;

  const { data, error: readError } = await admin.from("conversations")
    .select("livekit_profile_id, livekit_room, status, writer_generation")
    .eq("id", conversationId).maybeSingle();
  const conversation = data as ConversationTransport | null;
  if (readError || !conversation?.livekit_room) throw new Error("Interview transport could not be read.");
  const profile = (options.profiles ?? loadLiveKitProfiles())
    .find((candidate) => candidate.id === conversation.livekit_profile_id);
  // An established interview never moves projects; a disabled or missing
  // profile cannot host a replacement, and the bounded attempts run out.
  if (!profile || !profile.enabled || !profile.agentName) return "unavailable";
  try {
    await dispatchReplacementWorker(profile, conversation.livekit_room, options.clients);
  } catch (dispatchError) {
    // Provider failures wait for the next window; anything else is a defect.
    if (!classifyLiveKitFailure(dispatchError)) throw dispatchError;
  }
  return "recovering";
}

/**
 * Trusted terminal transition (participant end, researcher cancellation). The
 * RPC is idempotent, sets ended_at and the reason, clears the writer lease and
 * enqueues ejection in one transaction; ejection is then attempted at once.
 */
export async function endInterview(conversationId: string, status: EndingStatus, reason: EndingReason,
  options: { admin?: Client; profiles?: LiveKitProfile[]; clients?: LiveKitClients } = {}) {
  const admin = options.admin ?? createSupabaseSecretClient();
  const { data, error } = await admin.rpc("end_interview_conversation", {
    p_conversation_id: conversationId, p_status: status, p_reason: reason,
  });
  if (error || typeof data !== "string") throw new Error("Interview could not be ended.");
  await drainLifecycleOutbox({ ...options, admin, limit: 5 }).catch(() => undefined);
  return data;
}

export type OutboxResult = { completed: number; retrying: number; abandoned: number };

/**
 * Perform due ejections with each room's own project credentials. A missing room
 * is already ejected. Provider failures are rescheduled with backoff by the
 * database; after ten attempts a row is abandoned and stays visible for review.
 */
export async function drainLifecycleOutbox(options: {
  admin?: Client; profiles?: LiveKitProfile[]; clients?: LiveKitClients; limit?: number;
} = {}): Promise<OutboxResult> {
  const admin = options.admin ?? createSupabaseSecretClient();
  const clients = options.clients ?? liveKit;
  const nonce = randomUUID();
  const { data: due, error } = await admin.rpc("lease_interview_lifecycle_outbox", {
    p_nonce: nonce, p_limit: options.limit ?? 10, p_lock_seconds: 60,
  });
  if (error) throw new Error("Lifecycle outbox is unavailable.");
  const result: OutboxResult = { completed: 0, retrying: 0, abandoned: 0 };
  let profiles: LiveKitProfile[] | null = options.profiles ?? null;
  for (const row of (due ?? []) as { id: string; livekit_profile_id: string; livekit_room: string }[]) {
    let succeeded = false;
    let failure: string | null = null;
    try {
      profiles ??= loadLiveKitProfiles();
      const profile = profiles.find((candidate) => candidate.id === row.livekit_profile_id);
      if (!profile) throw new Error("profile not configured");
      await withProviderDeadline(clients.rooms(profile).deleteRoom(row.livekit_room));
      succeeded = true;
    } catch (deleteError) {
      if ((deleteError as { status?: unknown }).status === 404) succeeded = true;
      else failure = classifyLiveKitFailure(deleteError)?.reason ??
        (deleteError instanceof Error && deleteError.message === "profile not configured"
          ? "profile not configured" : "ejection failed");
    }
    const { data: settled } = await admin.rpc("settle_interview_lifecycle_outbox", {
      p_id: row.id, p_nonce: nonce, p_succeeded: succeeded, p_error: failure ?? undefined,
    });
    if (settled === "completed") result.completed += 1;
    else if (settled === "abandoned") result.abandoned += 1;
    else if (settled === "retry") result.retrying += 1;
  }
  return result;
}

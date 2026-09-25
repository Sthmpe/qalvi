import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

export const RESUME_COOKIE = "qalvi_interview_resume";
export const JOINED_COOKIE = "qalvi_interview_joined";
export const CONSENT_VERSION = "transcript-v1";
export const RESUME_SECONDS = 24 * 60 * 60;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Client = SupabaseClient<Database>;

export function newCapability() {
  return randomBytes(32).toString("base64url");
}

export function capabilityHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function validCapability(token: unknown): token is string {
  return typeof token === "string" && OPAQUE_TOKEN.test(token);
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}

export function participantCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/interview",
    maxAge: RESUME_SECONDS,
  };
}

/** A passive preview for informed consent. Only POST can consume a capability. */
export async function previewInvitation(token: string, admin?: Client) {
  if (!validCapability(token)) return null;
  const elevated = admin ?? createSupabaseSecretClient();
  const { data: invitation, error } = await elevated.from("interview_invitations")
    .select("study_id, workspace_id, expires_at, claimed_at, revoked_at")
    .eq("token_hash", capabilityHash(token)).maybeSingle();
  if (error || !invitation || invitation.claimed_at || invitation.revoked_at ||
    new Date(invitation.expires_at).getTime() <= Date.now()) return null;
  const { data: study, error: studyError } = await elevated.from("studies")
    .select("title, description, status")
    .eq("id", invitation.study_id).eq("workspace_id", invitation.workspace_id).maybeSingle();
  if (studyError || !study || study.status !== "active") return null;
  return { title: study.title, description: study.description };
}

/** RLS proves membership; the server derives tenancy from the returned study. */
export async function issueInvitation(studyId: string, researcherId: string, researcher: Client,
  admin?: Client) {
  if (!/^[0-9a-f-]{36}$/i.test(studyId)) return null;
  const { data: study, error: studyError } = await researcher.from("studies")
    .select("id, workspace_id, status").eq("id", studyId).maybeSingle();
  if (studyError || !study || study.status !== "active") return null;
  const { data: member, error: memberError } = await researcher.from("workspace_members")
    .select("user_id").eq("workspace_id", study.workspace_id).eq("user_id", researcherId).maybeSingle();
  if (memberError || !member) return null;
  const token = newCapability();
  const { data, error } = await (admin ?? createSupabaseSecretClient()).from("interview_invitations")
    .insert({ workspace_id: study.workspace_id, study_id: study.id, issued_by: researcherId,
      token_hash: capabilityHash(token) })
    .select("expires_at").single();
  if (error || !data) throw new Error("Invitation could not be created.");
  return { token, expiresAt: data.expires_at };
}

/** One database transaction consumes the invitation and creates one session. */
export async function claimInvitation(token: string, admin?: Client) {
  if (!validCapability(token)) return null;
  const resume = newCapability();
  const room = `qalvi-real-${randomUUID()}`;
  const { data: conversationId, error } = await (admin ?? createSupabaseSecretClient()).rpc("claim_interview_invitation", {
    p_invitation_hash: capabilityHash(token), p_resume_hash: capabilityHash(resume),
    p_livekit_room: room, p_consent_version: CONSENT_VERSION,
  });
  if (error || !conversationId) return null;
  return { resume, conversationId };
}

/** The browser supplies only a bearer cookie; the database resolves its scope. */
export async function resolveParticipant(token: unknown, admin?: Client) {
  if (!validCapability(token)) return null;
  const elevated = admin ?? createSupabaseSecretClient();
  const { data: id, error } = await elevated.rpc("resolve_interview_resume", {
    p_resume_hash: capabilityHash(token),
  });
  if (error || !id) return null;
  const { data: conversation, error: readError } = await elevated.from("conversations")
    .select("id, participant_id, study_id, workspace_id, livekit_room, status")
    .eq("id", id).maybeSingle();
  if (readError || !conversation?.livekit_room || !["pending", "in_progress", "interrupted"].includes(conversation.status)) return null;
  return conversation;
}

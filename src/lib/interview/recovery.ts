import "server-only";
import { capabilityHash, validCapability } from "./gateway";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { RecoverySnapshot } from "@/components/interview/recovery";

/** A capability resolves one conversation inside the service-only RPC. */
export async function readParticipantRecovery(token: unknown, afterSequence = -1, limit = 100) {
  if (!validCapability(token) || !Number.isInteger(afterSequence) || afterSequence < -1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  const { data, error } = await createSupabaseSecretClient().rpc("read_participant_interview_recovery", {
    p_resume_hash: capabilityHash(token), p_after_sequence: afterSequence, p_limit: limit,
  });
  if (error) throw new Error("Interview recovery is unavailable.");
  return data as unknown as RecoverySnapshot | null;
}

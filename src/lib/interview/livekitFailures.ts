export type LiveKitFailureReason =
  | "quota" | "assignment_timeout" | "transport_unavailable" | "service_unavailable" | "profile_disabled";

export class LiveKitProviderFailure extends Error {
  constructor(readonly reason: LiveKitFailureReason) {
    super(`LiveKit transport unavailable (${reason}).`);
  }
}

/** Only recognized provider failures can select another project. Never cascade on 4xx auth/config errors. */
export function classifyLiveKitFailure(error: unknown): LiveKitProviderFailure | null {
  if (error instanceof LiveKitProviderFailure) return error;
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (code === "quota_exceeded" || code === "resource_exhausted" ||
      /maximum number of connection minutes reached|quota exceeded|usage limit reached/.test(message)) {
    return new LiveKitProviderFailure("quota");
  }
  if (status !== null && status >= 500) return new LiveKitProviderFailure("service_unavailable");
  if (code === "etimedout" || code === "econnreset" || code === "econnrefused" ||
      error instanceof TypeError && /fetch failed|network/.test(message)) {
    return new LiveKitProviderFailure("transport_unavailable");
  }
  return null;
}

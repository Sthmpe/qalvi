import type { RecoverySnapshot } from "./recovery";

export type RecoveryMode = "fresh" | "answering" | "resumed" | "reply_uncertain";
export type LifecyclePhase = "switching" | "recovering" | "interrupted" | "reply_uncertain" | "expired" | "unavailable" | null;

export function recoveryExpectation(mode: string | undefined): "opening" | "waiting" | null {
  return mode === "fresh" ? "opening" : mode === "answering" ? "waiting" : null;
}

export function lifecycleError(status: number, code?: string) {
  if (status === 401) return "expired";
  if (status === 410 || code === "session_ended") return "ended";
  if (code === "recovery_unavailable" || code === "not_recoverable" || code === "recovery_unsupported") return "unavailable";
  return "retry";
}

export function terminalCopy(status: string, reason?: RecoverySnapshot["endReason"]) {
  if (status === "expired") return { title: "This session has expired", detail: "You can read the conversation already loaded here. Open your invitation to check whether a new interview is available." };
  if (status === "unavailable") return { title: "Qalvi could not restore this interview", detail: "Your saved conversation is kept here. You do not need to send your answers again." };
  if (status === "failed") return { title: "This interview cannot continue", detail: reason === "recovery_integrity"
    ? "Qalvi could not safely restore the conversation. Your saved words are kept here."
    : "The interview could not continue safely. Your saved conversation is kept here." };
  if (status === "cancelled") return { title: "This interview was cancelled", detail: reason === "researcher_cancelled"
    ? "The research team ended this interview. Your saved conversation remains available here."
    : "This interview has ended. Your saved conversation remains available here." };
  return { title: "Thank you for sharing your perspective", detail: reason === "participant_ended"
    ? "You ended the interview. Your saved conversation is available to read here."
    : "The interview is complete. Your saved conversation is available to read here." };
}

/** One bounded, abortable recovery loop. HTTP active is not proof an agent joined. */
export async function pollInterviewerRecovery({ signal, ready, request, onError,
  wait = abortableWait, now = Date.now, budgetMs = 180_000 }: {
  signal: AbortSignal;
  ready: () => boolean;
  request: () => Promise<{ status: number; code?: string }>;
  onError: (kind: ReturnType<typeof lifecycleError>) => void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  budgetMs?: number;
}) {
  const deadline = now() + budgetMs;
  let failures = 0;
  while (!signal.aborted && !ready() && now() < deadline) {
    try {
      const result = await request();
      if (signal.aborted || ready()) return;
      if (result.status !== 200 && result.status !== 202 && result.code !== "not_started") {
        const kind = lifecycleError(result.status, result.code);
        if (kind !== "retry") { onError(kind); return; }
        failures++;
      } else failures = 0;
    } catch {
      if (signal.aborted || ready()) return;
      failures++;
    }
    if (failures >= 5) { onError("retry"); return; }
    try { await wait(Math.min(failures ? 2000 * 2 ** Math.min(failures, 2) : 2000, deadline - now()), signal); }
    catch { return; }
  }
  if (!signal.aborted && !ready()) onError("retry");
}

export function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Cancelled")); return; }
    const abort = () => { clearTimeout(timer); reject(new Error("Cancelled")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

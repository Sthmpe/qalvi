import type { TranscriptMessage } from "./types";

export interface CanonicalMessage {
  id: string;
  sequence: number;
  speaker: "participant" | "interviewer";
  channel: "voice" | "text" | "visual";
  content: string;
  interrupted: boolean;
  eventKey: string | null;
  protocolVersion: number | null;
}

export interface RecoverySnapshot {
  status: string;
  sessionKey: string;
  messages: CanonicalMessage[];
  nextCursor: number;
  hasMore: boolean;
  replyUnconfirmed: boolean;
  controlPending: boolean;
  legacyHistory: boolean;
}

export const terminalInterview = (status: string) =>
  status === "completed" || status === "cancelled" || status === "failed";
export const draftStorageKey = (sessionKey: string) => `qalvi:draft:${sessionKey}`;

export function canonicalTranscript(messages: CanonicalMessage[]): TranscriptMessage[] {
  const byId = new Map<string, CanonicalMessage>();
  for (const message of messages) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence).map((message) => ({
    id: message.id, sequence: message.sequence, speaker: message.speaker === "interviewer" ? "ai" : "participant",
    text: message.content, isFinal: true, source: message.channel === "visual" ? "visual" : undefined,
  }));
}

export function mergeCanonical(previous: CanonicalMessage[], incoming: CanonicalMessage[]) {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

export interface StoredDraft { text: string; eventId: string; at: string; pending: boolean }

export function readStoredDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof value.text !== "string" || typeof value.eventId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(value.eventId) || typeof value.at !== "string") return null;
    return { text: value.text, eventId: value.eventId, at: value.at, pending: value.pending === true };
  } catch { return null; }
}

export function reconcileStoredDraft(record: StoredDraft | null, messages: CanonicalMessage[], status: string) {
  if (!record || terminalInterview(status) || messages.some((message) =>
    message.eventKey === `text:${record.eventId}`)) return null;
  return record;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
export type InterviewStatus = "idle" | "connecting" | "reconnecting" | "disconnected" | "failed" | "ready" | "waiting" | "delayed" | "listening" | "thinking" | "speaking" | "switching" | "recovering" | "interrupted" | "completed" | "cancelled" | "expired" | "unavailable";

export type InputMode = "voice" | "text";

export type Speaker = "ai" | "participant";

export interface TranscriptMessage {
  id: string;
  /** Canonical real-session order allocated by the database. */
  sequence?: number;
  speaker: Speaker;
  text: string;
  isFinal?: boolean;
  revision?: number;
  /** Set when the participant answered with an on-screen visual instead of speaking or typing. */
  source?: "visual";
}

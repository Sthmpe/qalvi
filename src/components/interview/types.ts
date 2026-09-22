export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
export type InterviewStatus = "idle" | "connecting" | "reconnecting" | "disconnected" | "failed" | "ready" | "waiting" | "delayed" | "listening" | "thinking" | "speaking";

export type InputMode = "voice" | "text";

export type Speaker = "ai" | "participant";

export interface TranscriptMessage {
  id: string;
  speaker: Speaker;
  text: string;
  isFinal?: boolean;
  revision?: number;
  /** Set when the participant answered with an on-screen visual instead of speaking or typing. */
  source?: "visual";
}

export type InterviewStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export type InputMode = "voice" | "text";

export type Speaker = "ai" | "participant";

export interface TranscriptMessage {
  id: string;
  speaker: Speaker;
  text: string;
  isFinal?: boolean;
  revision?: number;
}

export interface ConceptOption {
  id: string;
  label: string;
  description: string;
  /** Mocked comparison metric, 0-100, used to draw the mini bar chart. */
  interestScore: number;
}

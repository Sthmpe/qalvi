import type { TranscriptMessage } from "./types";

export function transcriptId(identity: string, segmentId: string) {
  return JSON.stringify([identity, segmentId]);
}

/** Updates a segment in place; late interim streams cannot undo a final. */
export function upsertTranscript(messages: TranscriptMessage[], incoming: TranscriptMessage): TranscriptMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id);
  if (index === -1) return incoming.text.trim() ? [...messages, incoming] : messages;
  const current = messages[index];
  if (current.isFinal) return messages;
  if (!incoming.isFinal && (incoming.revision ?? 0) < (current.revision ?? 0)) return messages;
  const next = [...messages];
  next[index] = { ...incoming, text: incoming.text || current.text };
  return next;
}

interface TranscriptReader extends AsyncIterable<string> {
  info: { id: string; attributes?: Record<string, string> };
}

/** Each stream is a snapshot of a segment; chunks within it are deltas. */
export async function readTranscript(
  reader: TranscriptReader, identity: string, speaker: TranscriptMessage["speaker"],
  revision: number, update: (message: TranscriptMessage) => void,
) {
  const id = transcriptId(identity, reader.info.attributes?.["lk.segment_id"] ?? reader.info.id);
  let text = "";
  for await (const chunk of reader) {
    text += chunk;
    update({ id, speaker, text, revision, isFinal: false });
  }
  // Agent streams can set final=true in the trailer, after the last chunk.
  const finalAttribute = reader.info.attributes?.["lk.transcription_final"];
  update({ id, speaker, text, revision, isFinal: finalAttribute !== "false" });
}

import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "./types";

interface TranscriptProps {
  messages: TranscriptMessage[];
  provisional?: TranscriptMessage | null;
}

export default function Transcript({ messages, provisional }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const container = scrollRef.current;
    if (container && following.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
  }, [messages, provisional]);

  if (messages.length === 0 && !provisional) {
    return (
      <div className="transcript-empty">
        <span aria-hidden="true">“</span>
        <p>Qalvi will begin the conversation.</p>
        <small>Your words and Qalvi&apos;s questions will appear here.</small>
      </div>
    );
  }

  return (
    <div className="transcript-scroll" ref={scrollRef} tabIndex={0} aria-label="Transcript messages"
      onScroll={(event) => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }}>
      {messages.map((message) => (
        <div
          key={message.id}
          aria-busy={message.isFinal === false}
          className={`transcript-message ${message.speaker === "ai" ? "interviewer" : "participant"}`}
        >
          <div>
            <div className="transcript-attribution"><strong>{message.speaker === "ai" ? "Qalvi" : "You"}</strong>
            {message.source === "visual" && (
              <span>
                On screen
              </span>
            )}
            {message.isFinal === false && <span>Transcribing…</span>}</div>
            <p>{message.text}</p>
          </div>
        </div>
      ))}
      {provisional && <div className="transcript-message provisional" aria-busy="true">
        <div><div className="transcript-attribution"><strong>{provisional.speaker === "ai" ? "Qalvi" : "You"}</strong><span>Live caption, saving</span></div>
          <p>{provisional.text}</p></div>
      </div>}
    </div>
  );
}

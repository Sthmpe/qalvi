import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "./types";

interface TranscriptProps {
  messages: TranscriptMessage[];
}

export default function Transcript({ messages }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const container = scrollRef.current;
    if (container && following.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="transcript-empty">
        <span aria-hidden="true">“</span>
        <p>A good conversation starts with you.</p>
        <small>Your words and Qalvi’s questions will appear here.</small>
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
    </div>
  );
}

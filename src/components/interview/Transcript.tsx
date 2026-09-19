import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "./types";

interface TranscriptProps {
  messages: TranscriptMessage[];
}

export default function Transcript({ messages }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-sm text-[var(--muted)]">
          Your conversation will appear here once the interview begins.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-1 py-2">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex animate-fade-in-up ${
            message.speaker === "ai" ? "justify-start" : "justify-end"
          }`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm sm:max-w-[75%] ${
              message.speaker === "ai"
                ? "rounded-tl-sm bg-[var(--surface)] text-[var(--foreground)]"
                : "rounded-tr-sm bg-[var(--accent)] text-white"
            }`}
          >
            {message.text}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

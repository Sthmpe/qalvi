import type { InterviewStatus } from "./types";

interface VoiceOrbProps {
  status: InterviewStatus;
}

const STATUS_LABEL: Record<InterviewStatus, string> = {
  idle: "Ready when you are",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/**
 * Central animated presence for the AI interviewer.
 * Pure CSS/Tailwind — no animation library.
 */
export default function VoiceOrb({ status }: VoiceOrbProps) {
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative flex h-40 w-40 items-center justify-center sm:h-48 sm:w-48">
        {/* Ambient rings — only animate while actively listening/speaking */}
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full border border-[var(--accent)]/25 transition-opacity duration-700 ${
            status === "listening" || status === "speaking"
              ? "animate-orb-ring opacity-100"
              : "opacity-0"
          }`}
        />
        <span
          aria-hidden
          className={`absolute inset-3 rounded-full border border-[var(--accent)]/20 transition-opacity duration-700 ${
            status === "listening" || status === "speaking"
              ? "animate-orb-ring [animation-delay:0.6s] opacity-100"
              : "opacity-0"
          }`}
        />

        {/* Core orb */}
        <div
          className={`relative h-24 w-24 rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--accent-soft),var(--accent)_70%)] shadow-[0_0_40px_-8px_var(--accent)] transition-transform duration-700 ease-out sm:h-28 sm:w-28 ${
            status === "thinking" || status === "connecting" ? "animate-orb-breathe" : ""
          } ${status === "speaking" ? "scale-105" : "scale-100"} ${
            status === "connecting" ? "opacity-70" : "opacity-100"
          }`}
        >
          <span
            aria-hidden
            className={`absolute inset-0 rounded-full bg-white/10 transition-opacity duration-500 ${
              status === "thinking" ? "opacity-100 animate-orb-shimmer" : "opacity-0"
            }`}
          />
        </div>
      </div>

      <p className="text-sm font-medium tracking-wide text-[var(--muted)]">
        {STATUS_LABEL[status]}
      </p>
    </div>
  );
}

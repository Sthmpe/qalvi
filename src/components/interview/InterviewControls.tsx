import { useState, type FormEvent } from "react";
import type { InputMode, InterviewStatus } from "./types";

interface InterviewControlsProps {
  started: boolean;
  status: InterviewStatus;
  mode: InputMode;
  connected: boolean;
  micEnabled: boolean;
  micBusy: boolean;
  sending: boolean;
  onStart: () => void;
  onToggleMode: () => void;
  onMicTap: () => void;
  onSendText: (text: string) => Promise<boolean>;
}

export default function InterviewControls({
  started,
  status,
  mode,
  connected,
  micEnabled,
  micBusy,
  sending,
  onStart,
  onToggleMode,
  onMicTap,
  onSendText,
}: InterviewControlsProps) {
  const [draft, setDraft] = useState("");
  const disabled = !connected || status === "connecting";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || disabled || sending) return;
    if (await onSendText(text)) setDraft("");
  }

  if (!started) {
    return (
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          className="rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_8px_30px_-8px_var(--accent)] transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          Start Interview
        </button>
        <button type="button" onClick={onToggleMode} className="text-xs font-medium text-[var(--muted)] hover:underline">
          {mode === "voice" ? "Type instead" : "Use voice instead"}
        </button>
        <p className="text-xs text-[var(--muted)]">Takes about 7–12 minutes · voice or text</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {mode === "voice" ? (
        <button
          type="button"
          onClick={onMicTap}
          disabled={disabled || micBusy}
          aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
          aria-pressed={micEnabled}
          className={`flex h-14 w-14 items-center justify-center rounded-full border transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
            micEnabled
              ? "border-[var(--accent)] bg-[var(--accent-soft)]/50 shadow-[0_0_0_6px_var(--accent-soft)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40"
          }`}
        >
          <MicIcon active={micEnabled} />
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full max-w-md items-center gap-2">
          <input
            type="text"
            aria-label="Your response"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={sending}
            placeholder={disabled ? "Waiting for response…" : "Type your response…"}
            className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || sending || !draft.trim()}
            className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={onToggleMode}
        disabled={status === "connecting" || micBusy || sending}
        className="text-xs font-medium text-[var(--muted)] underline-offset-4 transition-colors hover:text-[var(--foreground)] hover:underline"
      >
        {mode === "voice" ? "Type instead" : "Use voice instead"}
      </button>
    </div>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className={active ? "text-[var(--accent)]" : "text-[var(--muted)]"}
    >
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M6 11.5a6 6 0 0 0 12 0M12 19.5v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

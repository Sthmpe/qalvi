import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
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

export default function InterviewControls({ started, status, mode, connected, micEnabled,
  micBusy, sending, onStart, onToggleMode, onMicTap, onSendText }: InterviewControlsProps) {
  const [draft, setDraft] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const hasText = !!draft.trim();
  const listening = connected && micEnabled && mode === "voice";

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
  }, [draft, started]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!hasText || !connected || sending || submitting.current) return;
    const submitted = draft;
    submitting.current = true;
    try {
      if (await onSendText(submitted.trim())) {
        setDraft((current) => current === submitted ? "" : current);
      }
    } finally { submitting.current = false; }
  }

  if (!started) return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" onClick={onStart} className="interview-start rounded-full bg-[var(--accent)] px-8 py-3.5 text-sm font-semibold text-white">Start Interview</button>
      <button type="button" onClick={onToggleMode} className="text-xs text-[var(--muted)] hover:underline">{mode === "voice" ? "Type instead" : "Use voice instead"}</button>
      <p className="text-xs text-[var(--muted)]">Takes about 7–12 minutes · voice or text</p>
    </div>
  );

  return (
    <div className="participant-composer-wrap">
      <form className={`participant-composer ${listening ? "is-listening" : ""}`} onSubmit={handleSubmit}>
        <textarea ref={textarea} rows={1} aria-label="Your response" aria-describedby="composer-help"
          value={draft} placeholder="Share your thoughts…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const mobileReturn = window.matchMedia("(pointer: coarse)").matches && !event.ctrlKey && !event.metaKey;
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !mobileReturn) {
              event.preventDefault();
              void handleSubmit(event);
            }
          }} />
        <button type={hasText ? "submit" : "button"} className={`composer-action ${hasText ? "is-send" : ""}`}
          disabled={!connected || sending || micBusy}
          aria-label={hasText ? (sending ? "Sending response" : "Send response") : (listening ? "Mute microphone" : "Use microphone")}
          aria-pressed={hasText ? undefined : listening}
          onClick={hasText ? undefined : mode === "text" ? onToggleMode : onMicTap}>
          {hasText ? <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM6 11.5a6 6 0 0 0 12 0M12 19.5v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>}
        </button>
      </form>
      <div className="composer-footer">
        <span id="composer-help" role="status">
          {sending ? "Sending…" : !connected ? (status === "reconnecting" ? "Reconnecting. Your draft is kept." : "Your draft stays here until you can send.") : listening ? <><span className="composer-wave" aria-hidden="true"><i /><i /><i /></span>Microphone on</> : "Microphone off"}
        </span>
        <button type="button" onClick={onToggleMode} disabled={!connected || micBusy || sending}>
          {mode === "voice" ? "Type instead" : "Use voice"}
        </button>
      </div>
    </div>
  );
}

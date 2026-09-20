"use client";

import { useState } from "react";
import VoiceOrb from "./VoiceOrb";
import Transcript from "./Transcript";
import InterviewControls from "./InterviewControls";
import { useLiveKitSession } from "./useLiveKitSession";
import type { InputMode } from "./types";

export default function InterviewRoom() {
  const [mode, setMode] = useState<InputMode>("voice");
  const liveKit = useLiveKitSession();
  const started = liveKit.isActive || liveKit.status === "connecting";

  async function handleToggleMode() {
    const next = mode === "voice" ? "text" : "voice";
    if (!started || await liveKit.setMicrophone(next === "voice")) setMode(next);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--background)]">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="text-sm font-semibold tracking-tight text-[var(--foreground)]">Qalvi</span>
        <span className="text-xs text-[var(--muted)]">Research Session</span>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-8 sm:px-8">
        <div className="flex flex-col items-center gap-6 pt-4 pb-8 sm:pt-8">
          <VoiceOrb status={liveKit.status} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="min-h-[9rem] flex-1 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/40 p-3 sm:min-h-[12rem]">
            <Transcript messages={liveKit.messages} />
          </div>
          {liveKit.error && (
            <div role="alert" className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--surface)]/60 px-4 py-3 text-center text-sm text-[var(--muted)]">
              <p>{liveKit.error}</p>
            </div>
          )}
          {liveKit.audioBlocked && (
            <button type="button" onClick={() => void liveKit.enableAudio()}
              className="text-sm text-[var(--accent)] underline underline-offset-4">
              Enable interview audio
            </button>
          )}
        </div>

        <div className="mt-8 flex justify-center">
          <InterviewControls
            started={started}
            status={liveKit.status}
            mode={mode}
            connected={liveKit.isActive && liveKit.agentReady}
            micEnabled={liveKit.micEnabled}
            micBusy={liveKit.micBusy}
            sending={liveKit.sending}
            onStart={() => void liveKit.start(mode)}
            onToggleMode={() => void handleToggleMode()}
            onMicTap={() => void liveKit.setMicrophone(!liveKit.micEnabled)}
            onSendText={liveKit.sendText}
          />
        </div>
      </main>
    </div>
  );
}

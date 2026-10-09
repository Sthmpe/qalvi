"use client";

import { useEffect, useRef, useState } from "react";
import VoiceOrb from "./VoiceOrb";
import Transcript from "./Transcript";
import VisualStage from "./VisualStage";
import InterviewControls from "./InterviewControls";
import { useLiveKitSession } from "./useLiveKitSession";
import type { InputMode } from "./types";
import ParticipantHeader from "./ParticipantHeader";
import { terminalInterview, type RecoverySnapshot } from "./recovery";
import { terminalCopy } from "./lifecycle";
import EndInterviewDialog from "./EndInterviewDialog";
import "./participant.css";

export default function InterviewRoom({ tokenEndpoint, initialRecovery, readOnly = false }: {
  tokenEndpoint?: string; initialRecovery?: RecoverySnapshot; readOnly?: boolean
} = {}) {
  const [mode, setMode] = useState<InputMode>("voice");
  const liveKit = useLiveKitSession(tokenEndpoint, initialRecovery);
  const terminal = readOnly || liveKit.readOnly || terminalInterview(liveKit.recoveryStatus);
  const started = liveKit.isActive || liveKit.status === "connecting";
  const connected = !terminal && !liveKit.ending && liveKit.connection === "connected" && liveKit.agentReady;
  const endingCopy = terminalCopy(liveKit.phase === "expired" || liveKit.phase === "unavailable"
    ? liveKit.phase : liveKit.recoveryStatus, liveKit.endReason);
  const resumable = liveKit.phase === "interrupted" || liveKit.connection === "failed";
  const terminalNotice = useRef<HTMLElement>(null);
  useEffect(() => { if (terminal) terminalNotice.current?.focus(); }, [terminal]);

  async function handleToggleMode() {
    const next = mode === "voice" ? "text" : "voice";
    if (!started || await liveKit.setMicrophone(next === "voice")) setMode(next);
  }

  return (
    <div className={`participant-room ${started || terminal || initialRecovery?.messages.length ? "is-started" : "is-idle"} ${liveKit.display ? "has-visual" : ""}`}>
      <ParticipantHeader />

      <main className="conversation-room">
        <div className="interviewer-presence">
          <VoiceOrb status={liveKit.status} />
          <div className="conversation-intro">
            <p className="participant-eyebrow">YOUR PERSPECTIVE MATTERS</p>
            <h1>{terminal ? "Your conversation, kept here." : started ? "Room for your perspective." : "A little space to be heard."}</h1>
            <p>{terminal ? "Your saved words remain available to read." : started ? "Speak naturally or type. There are no right or wrong answers." : "Share your experiences with Qalvi, your AI interviewer. Follow the conversation wherever it leads."}</p>
          </div>
        </div>

        <div className="conversation-content">
          {liveKit.display && (
            <VisualStage
              key={liveKit.display.id}
              action={liveKit.display}
              response={liveKit.displayResponse}
              busy={terminal || liveKit.sending || !connected || !liveKit.visualReady}
              onRespond={(response) => void liveKit.respondToDisplay(response)}
            />
          )}
          <section className="conversation-transcript" aria-label="Conversation transcript">
            <div className="transcript-heading"><h2>Your conversation</h2><span>{initialRecovery ? "Saved conversation" : started ? "Live transcript" : "Voice or text"}</span></div>
            <Transcript messages={liveKit.messages} provisional={terminal ? null : liveKit.provisional} ended={terminal} />
          </section>
          {!terminal && initialRecovery && (liveKit.phase === "reply_uncertain" || liveKit.replyUnconfirmed && !started) && <p role="status" className="interview-notice">{liveKit.messages.some(message => message.speaker === "participant") ? "Your last answer was saved, but Qalvi's reply could not be confirmed. You can continue when you're ready. Your answer will not be sent again." : "Qalvi's opening could not be confirmed. You can begin when you're ready."}</p>}
          {!terminal && initialRecovery && liveKit.controlPending && !started && <p role="status" className="interview-notice">Your last answer is saved. Resume the interview so Qalvi can continue from it.</p>}
          {initialRecovery && liveKit.legacyHistory && liveKit.connection === "failed" && <p role="status" className="interview-notice">Earlier turns remain readable, but automatic recovery of this conversation is not available yet.</p>}
          {terminal && <section ref={terminalNotice} tabIndex={-1} role="status" className="interview-notice interview-terminal"><h2>{endingCopy.title}</h2><p>{endingCopy.detail}</p></section>}
          {!terminal && liveKit.phase === "recovering" && <p role="status" className="interview-notice">Restoring your interviewer. Your saved conversation and draft are kept here.</p>}
          {!terminal && liveKit.phase === "switching" && <p role="status" className="interview-notice">Finding another connection for this interview. Your conversation stays with you.</p>}
          {!terminal && liveKit.phase === "interrupted" && <p role="status" className="interview-notice">The interview is paused. Your saved answers and draft are kept here. Resume when you&apos;re ready.</p>}
          {!terminal && liveKit.agentReady && liveKit.connection === "connected" && liveKit.turn && liveKit.turn !== "responding" && <p role="status" className="interview-notice">
            {liveKit.turn === "delayed" ? "Qalvi is taking longer than expected. Your conversation is kept here. You do not need to send your answer again." : liveKit.turn === "opening" ? "Qalvi is preparing the opening question." : "Your answer was sent. Waiting for Qalvi to respond."}
          </p>}
          {!terminal && liveKit.connection === "reconnecting" && <p role="status" className="interview-notice">Reconnecting. Your conversation and draft are kept here.</p>}
          {!terminal && liveKit.connection === "connected" && !liveKit.voiceAvailable && <p role="status" className="interview-notice">Qalvi&apos;s voice is unavailable for now. Replies appear here as text, and you can keep speaking or typing.</p>}
          {!terminal && started && resumable && <button type="button" className="interview-reconnect" disabled={liveKit.ending} onClick={() => void liveKit.reconnect()}>{liveKit.phase === "interrupted" ? "Resume interview" : "Reconnect interview"}</button>}
          {!terminal && liveKit.display && !liveKit.visualReady && <p className="interview-notice">This visual is kept for reference. You can answer in words or wait for Qalvi to share a new visual.</p>}
          {!terminal && liveKit.error && (
            <div role="alert" className="interview-notice">
              <p>{liveKit.error}</p>
            </div>
          )}
          {!terminal && liveKit.audioBlocked && (
            <button type="button" onClick={() => void liveKit.enableAudio()}
              className="text-sm text-[var(--accent)] underline underline-offset-4">
              Enable interview audio
            </button>
          )}
        </div>

        {!terminal && <div className="conversation-controls">
          <InterviewControls
            started={started}
            status={liveKit.status}
            mode={mode}
            connected={connected}
            micEnabled={liveKit.micEnabled}
            micBusy={liveKit.micBusy}
            sending={liveKit.sending}
            onStart={() => void liveKit.start(mode)}
            onToggleMode={() => void handleToggleMode()}
            onMicTap={() => void liveKit.setMicrophone(!liveKit.micEnabled)}
            onSendText={liveKit.sendText}
            draft={initialRecovery ? liveKit.draft : undefined}
            onDraftChange={initialRecovery ? liveKit.setDraft : undefined}
            draftLocked={initialRecovery ? liveKit.draftLocked : false}
            onDiscardDraft={initialRecovery ? liveKit.discardDraft : undefined}
            startLabel={initialRecovery && (initialRecovery.messages.length > 0 || liveKit.phase === "interrupted") ? "Resume interview" : undefined}
            unavailable={liveKit.ending}
          />
        </div>}
        {!terminal && initialRecovery && <div className="conversation-ending"><EndInterviewDialog ending={liveKit.ending} onEnd={liveKit.endInterview} /></div>}
      </main>
    </div>
  );
}

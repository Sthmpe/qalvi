"use client";

import { useState } from "react";
import VoiceOrb from "./VoiceOrb";
import Transcript from "./Transcript";
import VisualStage from "./VisualStage";
import InterviewControls from "./InterviewControls";
import { useLiveKitSession } from "./useLiveKitSession";
import type { InputMode } from "./types";
import ParticipantHeader from "./ParticipantHeader";
import "./participant.css";

export default function InterviewRoom({ tokenEndpoint }: { tokenEndpoint?: string } = {}) {
  const [mode, setMode] = useState<InputMode>("voice");
  const liveKit = useLiveKitSession(tokenEndpoint);
  const started = liveKit.isActive || liveKit.status === "connecting";
  const connected = liveKit.connection === "connected" && liveKit.agentReady;

  async function handleToggleMode() {
    const next = mode === "voice" ? "text" : "voice";
    if (!started || await liveKit.setMicrophone(next === "voice")) setMode(next);
  }

  return (
    <div className={`participant-room ${started ? "is-started" : "is-idle"} ${liveKit.display ? "has-visual" : ""}`}>
      <ParticipantHeader />

      <main className="conversation-room">
        <div className="interviewer-presence">
          <VoiceOrb status={liveKit.status} />
          <div className="conversation-intro">
            <p className="participant-eyebrow">YOUR PERSPECTIVE MATTERS</p>
            <h1>{started ? "Room for your perspective." : "A little space to be heard."}</h1>
            <p>{started ? "Speak naturally or type. There are no right or wrong answers." : "Share your experiences with Qalvi, your AI interviewer. Follow the conversation wherever it leads."}</p>
          </div>
        </div>

        <div className="conversation-content">
          {liveKit.display && (
            <VisualStage
              key={liveKit.display.id}
              action={liveKit.display}
              response={liveKit.displayResponse}
              busy={liveKit.sending || !connected || !liveKit.visualReady}
              onRespond={(response) => void liveKit.respondToDisplay(response)}
            />
          )}
          <section className="conversation-transcript" aria-label="Conversation transcript">
            <div className="transcript-heading"><h2>Your conversation</h2><span>{started ? "Live transcript" : "Voice or text"}</span></div>
            <Transcript messages={liveKit.messages} />
          </section>
          {liveKit.connection === "connected" && liveKit.turn && liveKit.turn !== "responding" && <p role="status" className="interview-notice">
            {liveKit.turn === "delayed" ? "Qalvi is taking longer than expected. Your conversation is kept here. You do not need to send your answer again." : liveKit.turn === "opening" ? "Qalvi is preparing the opening question." : "Your answer was sent. Waiting for Qalvi to respond."}
          </p>}
          {liveKit.connection === "reconnecting" && <p role="status" className="interview-notice">Reconnecting. Your conversation and draft are kept here.</p>}
          {liveKit.connection === "connected" && !liveKit.voiceAvailable && <p role="status" className="interview-notice">Qalvi&apos;s voice is unavailable for now. Replies appear here as text, and you can keep speaking or typing.</p>}
          {liveKit.connection === "failed" && <button type="button" className="interview-reconnect" onClick={() => void liveKit.reconnect()}>Reconnect interview</button>}
          {liveKit.display && !liveKit.visualReady && <p className="interview-notice">This visual is kept for reference. You can answer in words or wait for Qalvi to share a new visual.</p>}
          {liveKit.error && (
            <div role="alert" className="interview-notice">
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

        <div className="conversation-controls">
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
          />
        </div>
      </main>
    </div>
  );
}

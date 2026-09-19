"use client";

import { useEffect, useRef, useState } from "react";
import VoiceOrb from "./VoiceOrb";
import Transcript from "./Transcript";
import InterviewControls from "./InterviewControls";
import VisualStage from "./VisualStage";
import { useLiveKitSession } from "./useLiveKitSession";
import {
  AI_CONCEPT_FOLLOW_UP,
  AI_CONCEPT_INTRO,
  AI_FOLLOW_UP_QUESTION,
  AI_GREETING,
  CONCEPT_OPTIONS,
  MOCK_PARTICIPANT_REPLIES,
} from "./mockData";
import type { InputMode, InterviewStatus, TranscriptMessage } from "./types";

const THINK_DELAY = 900;
const SPEAK_DELAY = 1900;

let messageId = 0;
function nextId() {
  messageId += 1;
  return `msg-${messageId}`;
}

/**
 * Which backend is actually driving the current conversation.
 * - "live": real LiveKit + Groq voice pipeline (Milestone 2 proof)
 * - "mock": Milestone 1's local, timer-based scripted conversation
 *
 * `mode` (voice/text) is only the participant's input-widget preference.
 * Choosing "voice" at Start Interview drives the real engine; "text"
 * stays mocked for now, per Milestone 2 scope (hybrid state-merging is
 * future work — see docs/ARCHITECTURE.md "Voice Architecture").
 */
type Engine = "live" | "mock" | null;

export default function InterviewRoom() {
  const [started, setStarted] = useState(false);
  const [engine, setEngine] = useState<Engine>(null);
  const [mode, setMode] = useState<InputMode>("voice");

  // --- Mock engine state (Milestone 1, unchanged) ---
  const [mockStatus, setMockStatus] = useState<InterviewStatus>("idle");
  const [mockMessages, setMockMessages] = useState<TranscriptMessage[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [visualVisible, setVisualVisible] = useState(false);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);

  const timers = useRef<number[]>([]);

  // --- Live engine state (Milestone 2) ---
  const liveKit = useLiveKitSession();

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((id) => window.clearTimeout(id));
      liveKit.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function schedule(fn: () => void, delay: number) {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
  }

  function say(speaker: TranscriptMessage["speaker"], text: string) {
    setMockMessages((prev) => [...prev, { id: nextId(), speaker, text }]);
  }

  function aiRespond(text: string, options?: { thenShowVisual?: boolean }) {
    setMockStatus("thinking");
    schedule(() => {
      setMockStatus("speaking");
      say("ai", text);
      schedule(() => {
        if (options?.thenShowVisual) {
          setVisualVisible(true);
        }
        setMockStatus("listening");
      }, SPEAK_DELAY);
    }, THINK_DELAY);
  }

  function startMockConversation() {
    setEngine("mock");
    setMockMessages([]);
    setTurnCount(0);
    setVisualVisible(false);
    setSelectedConceptId(null);
    aiRespond(AI_GREETING);
  }

  function handleStart() {
    setStarted(true);
    if (mode === "voice") {
      setEngine("live");
      void liveKit.start();
    } else {
      startMockConversation();
    }
  }

  function handleParticipantTurn(text: string) {
    if (mockStatus !== "listening") return;
    say("participant", text);

    const turn = turnCount + 1;
    setTurnCount(turn);

    if (turn === 1) {
      aiRespond(AI_FOLLOW_UP_QUESTION);
    } else if (turn === 2) {
      aiRespond(AI_CONCEPT_INTRO, { thenShowVisual: true });
    } else {
      aiRespond("Thank you — that's really useful context for the study.");
    }
  }

  function handleMicTap() {
    if (engine === "live") {
      liveKit.toggleMic();
      return;
    }
    const reply =
      MOCK_PARTICIPANT_REPLIES[turnCount] ??
      "That's roughly how it plays out for us most of the time.";
    handleParticipantTurn(reply);
  }

  function handleSendText(text: string) {
    handleParticipantTurn(text);
  }

  function handleToggleMode() {
    if (!started) {
      setMode((prev) => (prev === "voice" ? "text" : "voice"));
      return;
    }

    if (mode === "voice") {
      // Real voice session (or a failed attempt at one) → fall back to the
      // mocked text conversation. Merging live voice + text into one
      // engine is out of scope for this milestone.
      liveKit.stop();
      setMode("text");
      startMockConversation();
    } else {
      // Mocked conversation already running — just swap the input widget,
      // same behaviour as Milestone 1.
      setMode("voice");
    }
  }

  function handleSelectConcept(id: string) {
    if (mockStatus !== "listening" || selectedConceptId) return;
    setSelectedConceptId(id);
    const option = CONCEPT_OPTIONS.find((c) => c.id === id);
    say("participant", `I'd go with ${option?.label ?? "that one"}.`);
    aiRespond(AI_CONCEPT_FOLLOW_UP);
  }

  const status = engine === "live" ? liveKit.status : mockStatus;
  const messages = engine === "live" ? liveKit.messages : mockMessages;

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--background)]">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
          Qalvi
        </span>
        <span className="text-xs text-[var(--muted)]">Research Session</span>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-8 sm:px-8">
        <div className="flex flex-col items-center gap-6 pt-4 pb-8 sm:pt-8">
          <VoiceOrb status={status} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="min-h-[9rem] flex-1 rounded-3xl border border-[var(--border)] bg-[var(--surface)]/40 p-3 sm:min-h-[12rem]">
            <Transcript messages={messages} />
          </div>

          {engine === "live" && liveKit.error && (
            <div className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--surface)]/60 px-4 py-3 text-center text-sm text-[var(--muted)]">
              <p className="mb-2">{liveKit.error}</p>
              <button
                type="button"
                onClick={handleToggleMode}
                className="text-xs font-medium text-[var(--accent)] underline-offset-4 hover:underline"
              >
                Continue in text mode instead
              </button>
            </div>
          )}

          {engine === "mock" && visualVisible && (
            <VisualStage
              options={CONCEPT_OPTIONS}
              selectedId={selectedConceptId}
              onSelect={handleSelectConcept}
            />
          )}
        </div>

        <div className="mt-8 flex justify-center">
          <InterviewControls
            started={started}
            status={status}
            mode={mode}
            onStart={handleStart}
            onToggleMode={handleToggleMode}
            onMicTap={handleMicTap}
            onSendText={handleSendText}
          />
        </div>
      </main>
    </div>
  );
}

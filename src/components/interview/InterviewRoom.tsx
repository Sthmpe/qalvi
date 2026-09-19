"use client";

import { useEffect, useRef, useState } from "react";
import VoiceOrb from "./VoiceOrb";
import Transcript from "./Transcript";
import InterviewControls from "./InterviewControls";
import VisualStage from "./VisualStage";
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
 * Orchestrates the mocked Milestone 1 interview experience.
 * All state is local — no network, no LiveKit, no Groq, no Supabase.
 * This will be replaced by the real interview engine in later milestones.
 */
export default function InterviewRoom() {
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [mode, setMode] = useState<InputMode>("voice");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [visualVisible, setVisualVisible] = useState(false);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);

  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  function schedule(fn: () => void, delay: number) {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
  }

  function say(speaker: TranscriptMessage["speaker"], text: string) {
    setMessages((prev) => [...prev, { id: nextId(), speaker, text }]);
  }

  function aiRespond(text: string, options?: { thenShowVisual?: boolean }) {
    setStatus("thinking");
    schedule(() => {
      setStatus("speaking");
      say("ai", text);
      schedule(() => {
        if (options?.thenShowVisual) {
          setVisualVisible(true);
        }
        setStatus("listening");
      }, SPEAK_DELAY);
    }, THINK_DELAY);
  }

  function handleStart() {
    setStarted(true);
    aiRespond(AI_GREETING);
  }

  function handleParticipantTurn(text: string) {
    if (status !== "listening") return;
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
    if (status !== "listening") return;
    const reply =
      MOCK_PARTICIPANT_REPLIES[turnCount] ??
      "That's roughly how it plays out for us most of the time.";
    handleParticipantTurn(reply);
  }

  function handleSendText(text: string) {
    handleParticipantTurn(text);
  }

  function handleToggleMode() {
    setMode((prev) => (prev === "voice" ? "text" : "voice"));
  }

  function handleSelectConcept(id: string) {
    if (status !== "listening" || selectedConceptId) return;
    setSelectedConceptId(id);
    const option = CONCEPT_OPTIONS.find((c) => c.id === id);
    say("participant", `I'd go with ${option?.label ?? "that one"}.`);
    aiRespond(AI_CONCEPT_FOLLOW_UP);
  }

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

          {visualVisible && (
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

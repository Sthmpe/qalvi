"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import type { InputMode, InterviewStatus, TranscriptMessage } from "./types";
import { readTranscript, transcriptId, upsertTranscript } from "./transcription";

function mapAgentState(state: string | undefined): InterviewStatus | null {
  switch (state) {
    case "connecting": case "pre-connect-buffering": case "initializing": return "connecting";
    case "idle": case "listening": return "listening";
    case "thinking": return "thinking";
    case "speaking": return "speaking";
    default: return null;
  }
}

export function useLiveKitSession() {
  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const generation = useRef(0);
  const sendingRef = useRef(false);
  const micBusyRef = useRef(false);
  const attachedElements = useRef<HTMLMediaElement[]>([]);

  const detachAudio = useCallback(() => {
    attachedElements.current.forEach((el) => el.remove());
    attachedElements.current = [];
  }, []);
  const stop = useCallback(() => {
    generation.current += 1;
    const room = roomRef.current;
    roomRef.current = null;
    void room?.disconnect();
    detachAudio();
    sendingRef.current = false;
    micBusyRef.current = false;
    setSending(false);
    setMicBusy(false);
    setIsActive(false);
    setAgentReady(false);
    setMicEnabled(false);
    setStatus("idle");
  }, [detachAudio]);
  useEffect(() => stop, [stop]);

  const start = useCallback(async (mode: InputMode) => {
    if (roomRef.current) return;
    const attempt = ++generation.current;
    setError(null);
    setMessages([]);
    setAudioBlocked(false);
    setStatus("connecting");
    const room = new Room();
    roomRef.current = room;
    const current = () => roomRef.current === room && generation.current === attempt;
    const began = performance.now();
    const timing = (stage: string, details: Record<string, unknown> = {}) => {
      if (process.env.NODE_ENV === "development" && current()) {
        console.debug("[qalvi latency]", { stage, room: room.name, at: new Date().toISOString(),
          sessionMs: Math.round(performance.now() - began), ...details });
      }
    };
    let revision = 0;
    const finalSegments = new Set<string>();
    const updateAgent = () => {
      if (!current()) return;
      const agent = [...room.remoteParticipants.values()].find((p) => p.isAgent);
      const mapped = mapAgentState(agent?.attributes["lk.agent.state"]);
      setAgentReady(!!agent && !!mapped && mapped !== "connecting");
      setStatus(mapped ?? "connecting");
    };
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (!current() || track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.autoplay = true;
      el.style.display = "none";
      el.addEventListener("playing", () => timing("browser_playback_start", { track: track.sid }));
      document.body.appendChild(el);
      attachedElements.current.push(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      const removed = track.detach();
      removed.forEach((el) => el.remove());
      attachedElements.current = attachedElements.current.filter((el) => !removed.includes(el));
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (current()) setAudioBlocked(!room.canPlaybackAudio);
    });
    room.on(RoomEvent.ParticipantAttributesChanged, (attributes, participant) => {
      if (!current() || !participant.isAgent || !("lk.agent.state" in attributes)) return;
      timing("agent_state_received", { state: attributes["lk.agent.state"] });
      updateAgent();
    });
    room.on(RoomEvent.ParticipantConnected, updateAgent);
    room.on(RoomEvent.ParticipantDisconnected, updateAgent);
    room.on(RoomEvent.Reconnecting, () => {
      if (current()) { setAgentReady(false); setStatus("connecting"); }
    });
    room.on(RoomEvent.Reconnected, updateAgent);
    room.on(RoomEvent.Disconnected, () => {
      if (!current()) return;
      stop();
      setError("The interview disconnected. Start again to reconnect.");
    });
    room.registerTextStreamHandler("lk.transcription", async (reader, participant) => {
      const speaker = participant.identity === room.localParticipant.identity ? "participant" : "ai";
      try {
        await readTranscript(reader, participant.identity, speaker, ++revision, (message) => {
          if (!current()) return;
          setMessages((previous) => upsertTranscript(previous, message));
          if (message.isFinal && !finalSegments.has(message.id)) {
            finalSegments.add(message.id);
            timing("transcript_final_received", { segment: message.id, speaker });
          }
        });
      } catch {
        if (current()) setError("A transcript update was interrupted. You can continue the interview.");
      }
    });
    // Resume browser audio while still inside the Start button's user gesture.
    void room.startAudio().catch(() => { if (current()) setAudioBlocked(true); });
    try {
      const identity = `participant-${crypto.randomUUID()}`;
      const roomName = `qalvi-demo-${crypto.randomUUID()}`;
      const res = await fetch("/api/livekit-token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, identity }),
      });
      if (!res.ok) throw new Error("Could not reach the interview server.");
      const { serverUrl, token } = await res.json() as { serverUrl: string; token: string };
      if (!current()) return;
      await room.connect(serverUrl, token);
      if (!current()) { void room.disconnect(); return; }
      setIsActive(true);
      updateAgent();
      if (mode === "voice") {
        micBusyRef.current = true;
        setMicBusy(true);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (current()) setMicEnabled(true);
        } catch {
          if (current()) setError("Microphone access failed. You can type instead or retry the microphone.");
        } finally {
          if (current()) { micBusyRef.current = false; setMicBusy(false); }
        }
      }
    } catch (err) {
      if (!current()) return;
      stop();
      setError(err instanceof Error ? err.message : "Could not start the interview.");
    }
  }, [stop]);

  const setMicrophone = useCallback(async (enabled: boolean) => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected || micBusyRef.current) return false;
    micBusyRef.current = true;
    setMicBusy(true);
    setError(null);
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
      if (roomRef.current !== room) return false;
      setMicEnabled(enabled);
      return true;
    } catch {
      if (roomRef.current === room) setError("Could not change the microphone. Check browser permissions and try again.");
      return false;
    } finally {
      if (roomRef.current === room) { micBusyRef.current = false; setMicBusy(false); }
    }
  }, []);

  const sendText = useCallback(async (text: string) => {
    const room = roomRef.current;
    if (!text.trim() || !room || room.state !== ConnectionState.Connected || !agentReady || sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const info = await room.localParticipant.sendText(text.trim(), { topic: "lk.chat" });
      if (roomRef.current !== room) return false;
      // LiveKit does not echo outgoing chat messages to their sender.
      setMessages((previous) => upsertTranscript(previous, {
        id: transcriptId(room.localParticipant.identity, info.id),
        speaker: "participant", text: text.trim(), isFinal: true,
      }));
      if (process.env.NODE_ENV === "development") console.debug("[qalvi latency]", {
        stage: "text_sent", room: room.name, stream: info.id, at: new Date().toISOString(),
      });
      return true;
    } catch {
      if (roomRef.current === room) setError("Message could not be sent. Your draft is preserved; try again.");
      return false;
    } finally {
      if (roomRef.current === room) { sendingRef.current = false; setSending(false); }
    }
  }, [agentReady]);

  const enableAudio = useCallback(async () => {
    try { await roomRef.current?.startAudio(); }
    catch { setError("Audio playback is blocked. Check your browser's sound permissions."); }
  }, []);

  return { status, messages, error, isActive, agentReady, micEnabled, micBusy, sending,
    audioBlocked, start, stop, setMicrophone, sendText, enableAudio };
}

"use client";

import { useCallback, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { InterviewStatus, TranscriptMessage } from "./types";

let messageId = 0;
function nextId() {
  messageId += 1;
  return `live-${messageId}`;
}

/**
 * Maps the agent's `lk.agent.state` participant attribute (published by the
 * LiveKit Agents Python worker) onto our existing VoiceOrb states.
 * https://docs.livekit.io/frontends/build/agent-state/
 */
function mapAgentState(agentState: string | undefined): InterviewStatus | null {
  switch (agentState) {
    case "connecting":
    case "pre-connect-buffering":
    case "initializing":
      return "connecting";
    case "idle":
    case "listening":
      return "listening";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    default:
      return null;
  }
}

interface UseLiveKitSessionResult {
  status: InterviewStatus;
  messages: TranscriptMessage[];
  error: string | null;
  isActive: boolean;
  micEnabled: boolean;
  start: () => Promise<void>;
  stop: () => void;
  toggleMic: () => void;
}

/**
 * Smallest real end-to-end voice path for Milestone 2:
 * mint a token → join the LiveKit room → publish the mic → play the agent's
 * audio → surface agent state + transcriptions into the existing UI.
 *
 * No interview-engine logic, no Supabase, no Korra-specific content lives
 * here — this only proves the realtime voice transport works.
 */
export function useLiveKitSession(): UseLiveKitSessionResult {
  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);

  const roomRef = useRef<Room | null>(null);
  const attachedElementsRef = useRef<HTMLMediaElement[]>([]);

  const detachAudio = useCallback(() => {
    attachedElementsRef.current.forEach((el) => el.remove());
    attachedElementsRef.current = [];
  }, []);

  const stop = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    detachAudio();
    setIsActive(false);
    setStatus("idle");
  }, [detachAudio]);

  const start = useCallback(async () => {
    setError(null);
    setMessages([]);
    setStatus("connecting");

    try {
      const identity = `participant-${Math.random().toString(36).slice(2, 10)}`;
      const roomName = `qalvi-demo-${Math.random().toString(36).slice(2, 10)}`;

      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, identity }),
      });

      if (!res.ok) {
        throw new Error("Could not reach the voice session server.");
      }

      const { serverUrl, token } = (await res.json()) as {
        serverUrl: string;
        token: string;
      };

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          el.style.display = "none";
          document.body.appendChild(el);
          attachedElementsRef.current.push(el);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        const removed = track.detach();
        removed.forEach((el) => el.remove());
        attachedElementsRef.current = attachedElementsRef.current.filter(
          (el) => !removed.includes(el)
        );
      });

      room.on(RoomEvent.ParticipantAttributesChanged, (changedAttributes, participant) => {
        if ("lk.agent.state" in changedAttributes) {
          const mapped = mapAgentState(participant.attributes["lk.agent.state"]);
          if (mapped) setStatus(mapped);
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        detachAudio();
        setIsActive(false);
        setStatus("idle");
      });

      room.registerTextStreamHandler("lk.transcription", async (reader, participantInfo) => {
        const text = await reader.readAll();
        if (!text.trim()) return;
        const speaker = participantInfo.identity === room.localParticipant.identity
          ? "participant"
          : "ai";
        setMessages((prev) => [...prev, { id: nextId(), speaker, text }]);
      });

      await room.connect(serverUrl, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      setIsActive(true);
      setMicEnabled(true);

      // Pick up agent state if it was already published before we attached listeners.
      for (const participant of room.remoteParticipants.values()) {
        const mapped = mapAgentState(participant.attributes["lk.agent.state"]);
        if (mapped) setStatus(mapped);
      }
    } catch (err) {
      console.error("LiveKit session failed to start", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not start the voice session. Is the Qalvi agent running?"
      );
      roomRef.current?.disconnect();
      roomRef.current = null;
      detachAudio();
      setIsActive(false);
      setStatus("idle");
    }
  }, [detachAudio]);

  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micEnabled;
    room.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  }, [micEnabled]);

  return { status, messages, error, isActive, micEnabled, start, stop, toggleMic };
}

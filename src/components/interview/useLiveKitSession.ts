"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import type { ConnectionStatus, InputMode, InterviewStatus, TranscriptMessage } from "./types";
import { readTranscript, transcriptId, upsertTranscript } from "./transcription";
import { sessionHealth } from "./sessionHealth";
import {
  describeResponse, parseDisplayAction, RESPONSE_PREFIX,
  type DisplayAction, type VisualResponse,
} from "./visuals/display";

/** Text stream topic the agent uses to put a predefined visual on screen. */
export const DISPLAY_TOPIC = "qalvi.display";
const EVIDENCE_TOPIC = "qalvi.evidence";

/** Agent attribute set when speech synthesis is unavailable and the interview continues in text. */
export const VOICE_ATTRIBUTE = "qalvi.voice";

function mapAgentState(state: string | undefined): InterviewStatus | null {
  switch (state) {
    case "connecting": case "pre-connect-buffering": case "initializing": return "connecting";
    case "idle": case "listening": return "listening";
    case "thinking": return "thinking";
    case "speaking": return "speaking";
    default: return null;
  }
}

export function useLiveKitSession(tokenEndpoint = "/api/livekit-token") {
  const realSession = tokenEndpoint !== "/api/livekit-token";
  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [connection, setConnection] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [display, setDisplay] = useState<DisplayAction | null>(null);
  const [displayResponse, setDisplayResponse] = useState<VisualResponse | null>(null);
  const [visualReady, setVisualReady] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(true);
  const [turn, setTurn] = useState<"opening" | "waiting" | "responding" | "delayed" | null>(null);
  const roomRef = useRef<Room | null>(null);
  const activeDisplay = useRef<DisplayAction | null>(null);
  const answeredDisplays = useRef(new Set<string>());
  const generation = useRef(0);
  const sendingRef = useRef(false);
  const micBusyRef = useRef(false);
  const attachedElements = useRef<HTMLMediaElement[]>([]);
  const connectionRef = useRef<ConnectionStatus>("disconnected");
  const reconnectRef = useRef<(() => Promise<void>) | null>(null);
  const interruptedSend = useRef<(() => void) | null>(null);
  const pendingEvidence = useRef<{ id: string; wire: string; at: string } | null>(null);
  const evidenceResults = useRef(new Map<string, "saved" | "failed">());
  const evidenceWaiter = useRef<{ id: string; resolve: (status: "saved" | "failed") => void } | null>(null);
  const desiredMic = useRef(false);
  const monitor = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconcileRef = useRef<(() => void) | null>(null);
  const knownAiSegments = useRef(new Set<string>());
  const completedAiSegments = useRef(new Set<string>());
  const pendingTurn = useRef<{ since: number; excluded: Set<string> } | null>(null);
  const expectResponse = useCallback((opening = false, excluded = new Set(knownAiSegments.current)) => {
    pendingTurn.current = { since: Date.now(), excluded };
    setTurn(opening ? "opening" : "waiting");
  }, []);

  const changeConnection = useCallback((next: ConnectionStatus) => {
    connectionRef.current = next;
    setConnection(next);
    if (next !== "connected") {
      interruptedSend.current?.();
      setAgentReady(false);
      setStatus(next);
    }
  }, []);

  const detachAudio = useCallback(() => {
    attachedElements.current.forEach((el) => el.remove());
    attachedElements.current = [];
  }, []);
  const stop = useCallback(() => {
    generation.current += 1;
    changeConnection("disconnected");
    reconnectRef.current = null;
    reconcileRef.current = null;
    if (monitor.current) clearInterval(monitor.current);
    monitor.current = null;
    pendingTurn.current = null;
    knownAiSegments.current.clear();
    completedAiSegments.current.clear();
    pendingEvidence.current = null;
    evidenceResults.current.clear();
    evidenceWaiter.current = null;
    setTurn(null);
    const room = roomRef.current;
    roomRef.current = null;
    activeDisplay.current = null;
    setVisualReady(false);
    answeredDisplays.current.clear();
    void room?.disconnect();
    detachAudio();
    sendingRef.current = false;
    micBusyRef.current = false;
    setSending(false);
    setMicBusy(false);
    setIsActive(false);
    setAgentReady(false);
    setMicEnabled(false);
    setDisplay(null);
    setDisplayResponse(null);
    setVoiceAvailable(true);
    setStatus("idle");
  }, [detachAudio, changeConnection]);
  useEffect(() => stop, [stop]);

  const start = useCallback(async (mode: InputMode) => {
    if (roomRef.current) return;
    const attempt = ++generation.current;
    setError(null);
    setMessages([]);
    setDisplay(null);
    setDisplayResponse(null);
    setAudioBlocked(false);
    setVoiceAvailable(true);
    activeDisplay.current = null;
    setVisualReady(false);
    answeredDisplays.current.clear();
    setStatus("connecting");
    changeConnection("connecting");
    setIsActive(true);
    desiredMic.current = mode === "voice";
    let openingExpected = false;
    let hasConnected = false;
    let sessionUnavailable = false;
    let evidenceInterrupted = false;
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
    const seenDisplays = new Set<string>();
    const finalSegments = new Set<string>();
    const failConnection = () => {
      if (!current()) return;
      changeConnection("failed");
      setMicEnabled(false);
      detachAudio();
      activeDisplay.current = null;
      setVisualReady(false);
      setError(evidenceInterrupted
        ? "The interview paused because evidence could not be confirmed as saved. Your transcript and draft remain here."
        : sessionUnavailable
          ? "The previous interview has ended and cannot be resumed. Your transcript is still here. Open a new interview to begin again."
          : "Connection lost. Your conversation and draft are still here. Reconnect to try to resume.");
    };
    const updateAgent = () => {
      if (!current() || connectionRef.current !== "connected" || sessionHealth(room) !== "connected") return;
      const agent = [...room.remoteParticipants.values()].find((p) => p.isAgent);
      if (agent?.attributes["qalvi.session.status"] === "interrupted") {
        evidenceInterrupted = true;
        failConnection();
        void room.disconnect();
        return;
      }
      if (agent?.attributes["qalvi.session.status"] === "unavailable") {
        sessionUnavailable = true;
        failConnection();
        void room.disconnect();
        return;
      }
      // Lost speech output is not a lost connection: the session stays usable in text.
      if (agent?.attributes[VOICE_ATTRIBUTE] === "unavailable") setVoiceAvailable(false);
      const mapped = mapAgentState(agent?.attributes["lk.agent.state"]);
      setAgentReady(!!agent && !!mapped && mapped !== "connecting");
      setStatus(mapped ?? "connecting");
      if (!openingExpected && agent && mapped && mapped !== "connecting") {
        openingExpected = true;
        if (!knownAiSegments.current.size && !pendingTurn.current) expectResponse(true);
      }
    };
    const reconcile = () => {
      if (!current() || !hasConnected || connectionRef.current === "failed" || connectionRef.current === "connecting") return;
      const actual = sessionHealth(room);
      if (actual === "failed") {
        failConnection();
        void room.disconnect();
        return;
      }
      if (actual !== connectionRef.current) {
        changeConnection(actual);
      }
      if (actual === "connected") {
        setMicEnabled(room.localParticipant.isMicrophoneEnabled);
        updateAgent();
      }
      if (pendingTurn.current && Date.now() - pendingTurn.current.since >= 20000) setTurn("delayed");
    };
    reconcileRef.current = reconcile;
    monitor.current = setInterval(reconcile, 1000);
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
      if (!current() || !participant.isAgent
        || !("lk.agent.state" in attributes || "qalvi.session.status" in attributes || VOICE_ATTRIBUTE in attributes)) return;
      timing("agent_state_received", { state: attributes["lk.agent.state"] });
      updateAgent();
    });
    room.on(RoomEvent.ParticipantConnected, updateAgent);
    room.on(RoomEvent.ParticipantDisconnected, updateAgent);
    const recovering = () => {
      if (current()) changeConnection("reconnecting");
    };
    room.on(RoomEvent.Reconnecting, recovering);
    room.on(RoomEvent.SignalReconnecting, recovering);
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (!current()) return;
      if (state === ConnectionState.Disconnected) failConnection();
      else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) recovering();
      else if (state === ConnectionState.Connected) {
        changeConnection("connected");
        updateAgent();
      }
    });
    room.on(RoomEvent.Reconnected, () => {
      if (!current()) return;
      changeConnection("connected");
      updateAgent();
    });
    room.on(RoomEvent.Disconnected, failConnection);
    room.registerTextStreamHandler("lk.transcription", async (reader, participant) => {
      const speaker = participant.identity === room.localParticipant.identity ? "participant" : "ai";
      try {
        await readTranscript(reader, participant.identity, speaker, ++revision, (message) => {
          if (!current()) return;
          setMessages((previous) => upsertTranscript(previous, message));
          if (speaker === "ai" && message.text && !finalSegments.has(message.id)) {
            knownAiSegments.current.add(message.id);
            if (message.isFinal) completedAiSegments.current.add(message.id);
            if (!pendingTurn.current?.excluded.has(message.id)) {
              if (message.isFinal) { pendingTurn.current = null; setTurn(null); }
              else {
                pendingTurn.current = { since: Date.now(), excluded: pendingTurn.current?.excluded ?? new Set() };
                setTurn("responding");
              }
            }
          }
          if (message.isFinal && !finalSegments.has(message.id)) {
            finalSegments.add(message.id);
            if (speaker === "participant") expectResponse();
            timing("transcript_final_received", { segment: message.id, speaker });
          }
        });
      } catch {
        if (current()) setError("A transcript update was interrupted. You can continue the interview.");
      }
    });
    room.registerTextStreamHandler(DISPLAY_TOPIC, async (reader) => {
      let parsed: unknown;
      try { parsed = JSON.parse(await reader.readAll()); } catch { return; }
      if (!current() || connectionRef.current === "failed" || connectionRef.current === "disconnected") return;
      if (parsed === null) {
        // The interviewer took the visual off the screen (skipped, abandoned, or the interview closed).
        if (!current()) return;
        activeDisplay.current = null;
        setVisualReady(false);
        setDisplay(null);
        setDisplayResponse(null);
        timing("display_cleared");
        return;
      }
      const action = parseDisplayAction(parsed);
      if (!action || !current() || seenDisplays.has(action.id)) return;
      seenDisplays.add(action.id);
      activeDisplay.current = action;
      setVisualReady(true);
      setDisplay(action);
      setDisplayResponse(null);
      timing("display_received", { display: action.id, type: action.type });
    });
    if (realSession) room.registerTextStreamHandler(EVIDENCE_TOPIC, async (reader, participant) => {
      if (!current() || !room.remoteParticipants.get(participant.identity)?.isAgent) return;
      let result: unknown;
      try { result = JSON.parse(await reader.readAll()); } catch { return; }
      if (!result || typeof result !== "object") return;
      const ack = result as { eventId?: unknown; status?: unknown };
      if (typeof ack.eventId !== "string" || !/^[0-9a-f-]{36}$/i.test(ack.eventId) ||
          (ack.status !== "saved" && ack.status !== "failed")) return;
      evidenceResults.current.set(ack.eventId, ack.status);
      if (evidenceWaiter.current?.id === ack.eventId) evidenceWaiter.current.resolve(ack.status);
    });
    // Resume browser audio while still inside the Start button's user gesture.
    void room.startAudio().catch(() => { if (current()) setAudioBlocked(true); });
    const identity = `participant-${crypto.randomUUID()}`;
    const roomName = `qalvi-demo-${crypto.randomUUID()}`;
    let joining = false;
    const join = async () => {
      if (!current() || joining) return;
      joining = true;
      changeConnection("connecting");
      setError(null);
      try {
        const res = await fetch(tokenEndpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(realSession ? {} : { roomName, identity, resume: hasConnected }), signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error("Could not reach the interview server.");
        const { serverUrl, token } = await res.json() as { serverUrl: string; token: string };
        if (!current()) return;
        await room.connect(serverUrl, token);
        if (!current()) { void room.disconnect(); return; }
        if (realSession) {
          void fetch("/interview/api/joined", { method: "POST" }).catch(() => {});
        }
        setIsActive(true);
        hasConnected = true;
        changeConnection("connected");
        if (!openingExpected && !pendingTurn.current && !knownAiSegments.current.size) expectResponse(true);
        updateAgent();
        if (desiredMic.current) {
          micBusyRef.current = true;
          setMicBusy(true);
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
            if (current() && connectionRef.current === "connected") setMicEnabled(true);
          } catch {
            if (current()) setError("Microphone access failed. You can type instead or retry the microphone.");
          } finally {
            if (current()) { micBusyRef.current = false; setMicBusy(false); }
          }
        }
      } catch {
        if (!current()) return;
        changeConnection("failed");
        setError("Could not connect. Check your connection and try reconnecting. Your draft is kept here.");
      } finally {
        joining = false;
      }
    };
    reconnectRef.current = join;
    await join();
  }, [changeConnection, detachAudio, expectResponse, tokenEndpoint, realSession]);

  const reconnect = useCallback(async () => {
    if (connectionRef.current === "failed" || connectionRef.current === "disconnected") {
      await reconnectRef.current?.();
    }
  }, []);

  const setMicrophone = useCallback(async (enabled: boolean) => {
    const room = roomRef.current;
    if (!room || connectionRef.current !== "connected" || room.state !== ConnectionState.Connected || micBusyRef.current) return false;
    micBusyRef.current = true;
    setMicBusy(true);
    setError(null);
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
      if (roomRef.current !== room || connectionRef.current !== "connected") return false;
      setMicEnabled(enabled);
      desiredMic.current = enabled;
      return true;
    } catch {
      if (roomRef.current === room) setError("Could not change the microphone. Check browser permissions and try again.");
      return false;
    } finally {
      if (roomRef.current === room) { micBusyRef.current = false; setMicBusy(false); }
    }
  }, []);

  // Typed messages and on-screen answers share one chat path, so the agent sees one conversation.
  const sendChat = useCallback(async (
    wire: string, shown: Pick<TranscriptMessage, "text" | "source">, failure: string,
  ) => {
    reconcileRef.current?.();
    const room = roomRef.current;
    if (!wire.trim() || !room || connectionRef.current !== "connected" || room.state !== ConnectionState.Connected || !agentReady || sendingRef.current) return false;
    sendingRef.current = true;
    const precedingAiSegments = new Set(knownAiSegments.current);
    setSending(true);
    setError(null);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const interruption = new Promise<never>((_, reject) => {
      interruptedSend.current = () => reject(new Error("Send interrupted"));
      timeout = setTimeout(() => reject(new Error("Send timed out")), realSession ? 45000 : 15000);
    });
    try {
      if (realSession && shown.source === "visual") {
        setError("On-screen answers are not available in this live study yet.");
        return false;
      }
      const pending = realSession
        ? pendingEvidence.current?.wire === wire ? pendingEvidence.current
          : { id: crypto.randomUUID(), wire, at: new Date().toISOString() }
        : null;
      if (pending) pendingEvidence.current = pending;
      const info = await Promise.race([room.localParticipant.sendText(wire, {
        topic: "lk.chat", ...(pending ? { attributes: {
          "qalvi.event_id": pending.id, "qalvi.event_at": pending.at,
        } } : {}),
      }), interruption]);
      if (roomRef.current !== room) return false;
      if (pending) {
        const acknowledgement = evidenceResults.current.get(pending.id) ?? await Promise.race([
          new Promise<"saved" | "failed">((resolve) => { evidenceWaiter.current = { id: pending.id, resolve }; }),
          interruption,
        ]);
        evidenceWaiter.current = null;
        evidenceResults.current.delete(pending.id);
        if (acknowledgement !== "saved") throw new Error("Evidence was not saved");
        pendingEvidence.current = null;
      }
      // LiveKit does not echo outgoing chat messages to their sender.
      setMessages((previous) => upsertTranscript(previous, {
        id: transcriptId(room.localParticipant.identity, info.id),
        speaker: "participant", isFinal: true, ...shown,
      }));
      // A fast agent may answer before sendText settles. Do not wait again for
      // a response already received, or mistake an older greeting for that reply.
      if (![...completedAiSegments.current].some((id) => !precedingAiSegments.has(id))) {
        expectResponse(false, precedingAiSegments);
        if ([...knownAiSegments.current].some((id) => !precedingAiSegments.has(id))) setTurn("responding");
      }
      reconcileRef.current?.();
      if (process.env.NODE_ENV === "development") console.debug("[qalvi latency]", {
        stage: "text_sent", room: room.name, stream: info.id, at: new Date().toISOString(),
      });
      return true;
    } catch {
      if (roomRef.current === room) setError(failure);
      return false;
    } finally {
      clearTimeout(timeout);
      interruptedSend.current = null;
      if (roomRef.current === room) { sendingRef.current = false; setSending(false); }
    }
  }, [agentReady, expectResponse, realSession]);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    return sendChat(trimmed, { text: trimmed }, "Delivery could not be confirmed. Your draft is kept. Check the conversation before retrying.");
  }, [sendChat]);

  const respondToDisplay = useCallback(async (response: VisualResponse) => {
    const action = activeDisplay.current;
    const attempt = generation.current;
    if (!action || answeredDisplays.current.has(action.id)) return false;
    const summary = describeResponse(action, response);
    if (!summary) return false;
    const sent = await sendChat(
      `${RESPONSE_PREFIX} ${summary}`, { text: summary, source: "visual" },
      "Your answer could not be shared. Try again.",
    );
    if (sent && generation.current === attempt) {
      answeredDisplays.current.add(action.id);
      if (activeDisplay.current === action) setDisplayResponse(response);
    }
    return sent;
  }, [sendChat]);

  const enableAudio = useCallback(async () => {
    try { await roomRef.current?.startAudio(); }
    catch { setError("Audio playback is blocked. Check your browser's sound permissions."); }
  }, []);

  const participantStatus: InterviewStatus = connection === "connected"
    ? turn === "delayed" ? "delayed"
      : turn === "responding" ? "speaking"
      : turn && status !== "thinking" ? "waiting"
      : status === "listening" && !micEnabled ? "ready" : status
    : status;
  return { status: participantStatus, connection, turn, messages, error, isActive, agentReady, micEnabled, micBusy, sending,
    visualReady, voiceAvailable,
    audioBlocked, display, displayResponse, start, stop, reconnect, setMicrophone, sendText, respondToDisplay, enableAudio };
}

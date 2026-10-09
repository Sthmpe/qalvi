"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionErrorReason, ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import type { ConnectionStatus, InputMode, InterviewStatus, TranscriptMessage } from "./types";
import { readTranscript, transcriptId, upsertTranscript } from "./transcription";
import { sessionHealth } from "./sessionHealth";
import { abortableWait, lifecycleError, pollInterviewerRecovery, recoveryExpectation, type LifecyclePhase } from "./lifecycle";
import { canonicalTranscript, draftStorageKey, mergeCanonical, readStoredDraft, reconcileStoredDraft, terminalInterview,
  type CanonicalMessage, type RecoverySnapshot, type StoredDraft } from "./recovery";
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

function providerConnectFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const failure = error as { reason?: unknown; status?: unknown; context?: { status?: unknown } };
  if (typeof failure.status === "number" && failure.status >= 400 && failure.status < 500) return false;
  if (failure.reason === ConnectionErrorReason.ServerUnreachable ||
      failure.reason === ConnectionErrorReason.Timeout ||
      failure.reason === ConnectionErrorReason.WebSocket) return true;
  return failure.reason === ConnectionErrorReason.InternalError &&
    typeof failure.context?.status === "number" && failure.context.status >= 500;
}

export function useLiveKitSession(tokenEndpoint = "/api/livekit-token", initialRecovery?: RecoverySnapshot) {
  const realSession = tokenEndpoint !== "/api/livekit-token";
  const canonicalRef = useRef<CanonicalMessage[]>(initialRecovery?.messages ?? []);
  const [recoveryStatus, setRecoveryStatus] = useState(initialRecovery?.status ?? "pending");
  const [replyUnconfirmed, setReplyUnconfirmed] = useState(initialRecovery?.replyUnconfirmed ?? false);
  const [controlPending, setControlPending] = useState(initialRecovery?.controlPending ?? false);
  const [legacyHistory, setLegacyHistory] = useState(initialRecovery?.legacyHistory ?? false);
  const [endReason, setEndReason] = useState(initialRecovery?.endReason ?? null);
  const [phase, setPhase] = useState<LifecyclePhase>(initialRecovery?.status === "interrupted" ? "interrupted" : null);
  const [ending, setEnding] = useState(false);
  const lifecycleRef = useRef(initialRecovery);
  const blocked = useRef(terminalInterview(initialRecovery?.status ?? ""));
  const endingRef = useRef(false);
  const recoveryPoll = useRef<AbortController | null>(null);
  const requests = useRef(new Set<AbortController>());
  const stateRequest = useRef<Promise<void> | null>(null);
  const agentIdentity = useRef<string | null>(null);
  const transport = useRef<number | null>(null);
  const recoverRef = useRef<(() => void) | null>(null);
  const recoveryPaused = useRef(initialRecovery?.status === "interrupted");
  const recoveryRequested = useRef(false);
  const [draft, setDraftState] = useState("");
  const [draftLocked, setDraftLocked] = useState(false);
  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [connection, setConnection] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<TranscriptMessage[]>(canonicalTranscript(initialRecovery?.messages ?? []));
  const [provisional, setProvisional] = useState<TranscriptMessage | null>(null);
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
  const storedDraft = useRef<StoredDraft | null>(null);
  const evidenceResults = useRef(new Map<string, "saved" | "failed">());
  const evidenceWaiter = useRef<{ id: string; resolve: (status: "saved" | "failed") => void } | null>(null);
  const desiredMic = useRef(false);
  const monitor = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconcileRef = useRef<(() => void) | null>(null);
  const knownAiSegments = useRef(new Set<string>());
  const completedAiSegments = useRef(new Set<string>());
  const pendingTurn = useRef<{ since: number; excluded: Set<string>; afterSequence?: number } | null>(null);
  const expectResponse = useCallback((opening = false, excluded = new Set(knownAiSegments.current)) => {
    setPhase(null);
    pendingTurn.current = { since: Date.now(), excluded, afterSequence: canonicalRef.current.at(-1)?.sequence ?? -1 };
    setTurn(opening ? "opening" : "waiting");
  }, []);

  const clearTurn = useCallback(() => { pendingTurn.current = null; setTurn(null); }, []);
  const cancelRequests = useCallback(() => {
    recoveryPoll.current?.abort();
    recoveryPoll.current = null;
    for (const controller of requests.current) controller.abort();
    requests.current.clear();
  }, []);

  const clearDraft = useCallback(() => {
    storedDraft.current = null;
    pendingEvidence.current = null;
    setDraftState("");
    setDraftLocked(false);
    if (initialRecovery) sessionStorage.removeItem(draftStorageKey(initialRecovery.sessionKey));
  }, [initialRecovery]);

  const setDraft = useCallback((text: string) => {
    if (draftLocked || blocked.current || endingRef.current) return;
    setDraftState(text);
    if (!initialRecovery) return;
    if (!text) { clearDraft(); return; }
    const record = storedDraft.current?.text === text ? storedDraft.current
      : { text, eventId: crypto.randomUUID(), at: new Date().toISOString(), pending: false };
    storedDraft.current = record;
    sessionStorage.setItem(draftStorageKey(initialRecovery.sessionKey), JSON.stringify(record));
  }, [initialRecovery, draftLocked, clearDraft]);

  useEffect(() => {
    if (!initialRecovery) return;
    const read = readStoredDraft(sessionStorage.getItem(draftStorageKey(initialRecovery.sessionKey)));
    const record = reconcileStoredDraft(read, initialRecovery.messages, initialRecovery.status);
    if (!record) {
      sessionStorage.removeItem(draftStorageKey(initialRecovery.sessionKey));
      return;
    }
    storedDraft.current = record;
    if (record.pending) pendingEvidence.current = { id: record.eventId, wire: record.text.trim(), at: record.at };
    let active = true;
    queueMicrotask(() => {
      if (active) { setDraftState(record.text); setDraftLocked(record.pending); }
    });
    return () => { active = false; };
  }, [initialRecovery]);

  const fetchRecovery = useCallback(async () => {
    if (!initialRecovery) return;
    if (stateRequest.current) return stateRequest.current;
    const controller = new AbortController();
    requests.current.add(controller);
    const epoch = generation.current;
    const run = async () => {
      let cursor = canonicalRef.current.at(-1)?.sequence ?? -1;
      for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
        const response = await fetch(`/interview/api/state?afterSequence=${cursor}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (controller.signal.aborted || epoch !== generation.current) return;
        if (response.status === 401) {
          if (!terminalInterview(lifecycleRef.current?.status ?? "")) {
            blocked.current = true; setPhase("expired"); clearDraft(); clearTurn();
            setAgentReady(false); void roomRef.current?.disconnect();
          }
          return;
        }
        if (!response.ok) throw new Error("Saved conversation could not be checked.");
        const page = await response.json() as RecoverySnapshot;
        if (controller.signal.aborted || epoch !== generation.current) return;
        if (page.sessionKey !== initialRecovery.sessionKey) throw new Error("Interview session changed.");
        // A late in-progress read must never revive a confirmed ending.
        if (terminalInterview(lifecycleRef.current?.status ?? "") && !terminalInterview(page.status)) return;
        lifecycleRef.current = page;
        setRecoveryStatus(page.status); setEndReason(page.endReason ?? null);
        setReplyUnconfirmed(page.replyUnconfirmed); setControlPending(page.controlPending);
        setLegacyHistory(page.legacyHistory);
        const merged = mergeCanonical(canonicalRef.current, page.messages);
        canonicalRef.current = merged;
        setMessages(canonicalTranscript(merged));
        if (pendingTurn.current && merged.some(message => message.speaker === "interviewer" &&
            message.sequence > (pendingTurn.current?.afterSequence ?? Infinity))) clearTurn();
        if (page.messages.length) setProvisional(null);
        const saved = storedDraft.current && merged.some((message) => message.eventKey === `text:${storedDraft.current?.eventId}`);
        if (saved || terminalInterview(page.status)) clearDraft();
        if (terminalInterview(page.status)) {
          blocked.current = true; clearTurn(); recoveryPoll.current?.abort();
          setAgentReady(false); setProvisional(null); void roomRef.current?.disconnect();
        } else if (page.status === "interrupted" && !agentIdentity.current && !page.recovering && !recoveryRequested.current) {
          recoveryPaused.current = true;
          recoveryPoll.current?.abort(); clearTurn(); setPhase("interrupted");
        }
        if (!page.hasMore || page.nextCursor <= cursor) break;
        cursor = page.nextCursor;
      }
    };
    const pending = run().finally(() => {
      requests.current.delete(controller);
      if (stateRequest.current === pending) stateRequest.current = null;
    });
    stateRequest.current = pending;
    return pending;
  }, [initialRecovery, clearDraft, clearTurn]);

  const changeConnection = useCallback((next: ConnectionStatus) => {
    connectionRef.current = next;
    setConnection(next);
    if (next !== "connected") {
      recoveryPoll.current?.abort();
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
    cancelRequests();
    stateRequest.current = null;
    agentIdentity.current = null;
    recoverRef.current = null;
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
    endingRef.current = false;
    setEnding(false);
    recoveryRequested.current = false;
    setIsActive(false);
    setAgentReady(false);
    setMicEnabled(false);
    setDisplay(null);
    setDisplayResponse(null);
    setVoiceAvailable(true);
    setStatus("idle");
  }, [detachAudio, changeConnection, cancelRequests]);
  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!realSession || !isActive || blocked.current || phase === "expired" || phase === "unavailable") return;
    let active = true;
    let failures = 0;
    const timer = setInterval(() => { void fetchRecovery().then(() => {
      if (active) failures = 0;
    }).catch(() => {
      if (active && ++failures >= 3) setError("Could not check your saved conversation. Your draft is kept. Try reconnecting.");
    }); }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [realSession, fetchRecovery, connection, recoveryStatus, isActive, phase]);

  useEffect(() => {
    if (realSession && (terminalInterview(recoveryStatus) || phase === "expired" || phase === "unavailable") && roomRef.current) stop();
  }, [realSession, recoveryStatus, phase, stop]);

  const start = useCallback(async (mode: InputMode) => {
    if (roomRef.current || blocked.current || endingRef.current) return;
    const attempt = ++generation.current;
    setError(null);
    if (!realSession) setMessages([]);
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
    let expectationKey = "";
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
      if (blocked.current) { changeConnection("disconnected"); return; }
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
      if (!current() || blocked.current || connectionRef.current !== "connected" || sessionHealth(room) !== "connected") return;
      const agents = [...room.remoteParticipants.values()].filter((p) => p.isAgent);
      const agent = agents.find((p) => p.identity === agentIdentity.current) ?? agents.at(-1);
      agentIdentity.current = agent?.identity ?? null;
      if (!agent) {
        setAgentReady(false); clearTurn();
        if (realSession) recoverRef.current?.();
        else setStatus("connecting");
        return;
      }
      const terminalStatus = agent.attributes["qalvi.session.status"];
      if (realSession && terminalInterview(terminalStatus)) {
        blocked.current = true;
        lifecycleRef.current = { ...lifecycleRef.current!, status: terminalStatus };
        setRecoveryStatus(terminalStatus); setAgentReady(false); clearDraft(); clearTurn();
        recoveryPoll.current?.abort(); void fetchRecovery().catch(() => {}); void room.disconnect();
        return;
      }
      if (agent?.attributes["qalvi.session.status"] === "interrupted") {
        evidenceInterrupted = true;
        recoveryPaused.current = true;
        clearTurn(); setPhase("interrupted"); agentIdentity.current = null;
        void fetchRecovery().catch(() => {});
        failConnection();
        void room.disconnect();
        return;
      }
      if (agent?.attributes["qalvi.session.status"] === "unavailable") {
        sessionUnavailable = true;
        if (realSession) { blocked.current = true; setPhase("unavailable"); clearTurn(); }
        failConnection();
        void room.disconnect();
        return;
      }
      // Lost speech output is not a lost connection: the session stays usable in text.
      if (agent?.attributes[VOICE_ATTRIBUTE] === "unavailable") setVoiceAvailable(false);
      const mapped = mapAgentState(agent?.attributes["lk.agent.state"]);
      setAgentReady(!!agent && !!mapped && mapped !== "connecting");
      setStatus(mapped ?? "connecting");
      if (realSession && mapped && mapped !== "connecting") {
        recoveryRequested.current = false;
        recoveryPoll.current?.abort();
        const mode = agent.attributes["qalvi.recovery"] ??
          (lifecycleRef.current?.replyUnconfirmed && lifecycleRef.current?.writerActive ? "reply_uncertain" : undefined);
        const key = `${agent.identity}:${mode ?? ""}`;
        if (mode && key !== expectationKey) {
          expectationKey = key;
          clearTurn();
          const expectation = recoveryExpectation(mode);
          // Recovery attributes describe worker startup, not every later join.
          // A surviving worker can still say fresh/answering after its reply
          // was saved; refreshing must not expect that output a second time.
          const lastAnswer = canonicalRef.current.filter(message => message.speaker === "participant").at(-1);
          const outputSaved = expectation === "opening"
            ? canonicalRef.current.some(message => message.speaker === "interviewer")
            : lastAnswer && canonicalRef.current.some(message => message.speaker === "interviewer" && message.sequence > lastAnswer.sequence);
          if (expectation && !outputSaved) expectResponse(expectation === "opening");
          else setPhase(mode === "reply_uncertain" ? "reply_uncertain" : null);
        } else if (!mode) setPhase(null);
      } else if (!openingExpected && agent && mapped && mapped !== "connecting") {
        openingExpected = true;
        if (!knownAiSegments.current.size && !pendingTurn.current) expectResponse(true);
      }
    };
    recoverRef.current = () => {
      if (!realSession || blocked.current || recoveryPaused.current || !current() || agentIdentity.current || recoveryPoll.current && !recoveryPoll.current.signal.aborted) return;
      const controller = new AbortController();
      recoveryPoll.current = controller;
      void (async () => {
        try { await fetchRecovery(); } catch {
          if (!controller.signal.aborted && current()) {
            setError("Could not check the conversation. Your draft is kept. Retry recovery when your connection returns.");
            setPhase("interrupted");
            recoveryPaused.current = true;
          }
          return;
        }
        if (controller.signal.aborted || !current() || blocked.current || agentIdentity.current) return;
        setPhase("recovering"); clearTurn();
        await pollInterviewerRecovery({ signal: controller.signal,
          ready: () => !current() || blocked.current || !!agentIdentity.current,
          request: async () => {
            const response = await fetch("/interview/api/recover", { method: "POST",
              headers: { "Content-Type": "application/json" }, body: "{}",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
            const body = await response.json().catch(() => ({})) as { code?: string };
            if (!controller.signal.aborted && current() && response.status === 202) recoveryRequested.current = true;
            if (response.status === 410) await fetchRecovery();
            return { status: response.status, code: body.code };
          }, onError: (kind) => {
            if (!current() || controller.signal.aborted) return;
            clearTurn(); setAgentReady(false);
            if (kind === "expired") { blocked.current = true; setPhase("expired"); clearDraft(); void room.disconnect(); }
            else if (kind === "unavailable" || kind === "ended") {
              blocked.current = true; setPhase("unavailable"); void room.disconnect();
            } else { recoveryPaused.current = true; setPhase("interrupted"); setError("Qalvi could not rejoin yet. Your saved conversation and draft are kept. You can retry."); }
          } });
      })().finally(() => { if (recoveryPoll.current === controller) recoveryPoll.current = null; });
    };
    const reconcile = () => {
      if (!current() || blocked.current || !hasConnected || connectionRef.current === "failed" || connectionRef.current === "connecting") return;
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
        || !("lk.agent.state" in attributes || "qalvi.session.status" in attributes || "qalvi.recovery" in attributes || VOICE_ATTRIBUTE in attributes)) return;
      timing("agent_state_received", { state: attributes["lk.agent.state"] });
      updateAgent();
    });
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (current() && participant?.isAgent) agentIdentity.current = participant.identity;
      updateAgent();
    });
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
      if (realSession) void fetchRecovery().catch(() => setError("Could not reload saved conversation. Try reconnecting."));
    });
    room.on(RoomEvent.Disconnected, failConnection);
    room.registerTextStreamHandler("lk.transcription", async (reader, participant) => {
      const speaker = participant.identity === room.localParticipant.identity ? "participant" : "ai";
      try {
        await readTranscript(reader, participant.identity, speaker, ++revision, (message) => {
          if (!current() || blocked.current) return;
          if (speaker === "ai" && (!room.remoteParticipants.get(participant.identity)?.isAgent ||
              agentIdentity.current && participant.identity !== agentIdentity.current)) return;
          if (realSession) setProvisional(message);
          else setMessages((previous) => upsertTranscript(previous, message));
          if (speaker === "ai" && message.text && !finalSegments.has(message.id)) {
            knownAiSegments.current.add(message.id);
            if (message.isFinal) completedAiSegments.current.add(message.id);
            if (!pendingTurn.current?.excluded.has(message.id)) {
              if (message.isFinal) { pendingTurn.current = null; setTurn(null); }
              else {
                pendingTurn.current = { since: Date.now(), excluded: pendingTurn.current?.excluded ?? new Set(),
                  afterSequence: pendingTurn.current?.afterSequence };
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
      if (!current() || blocked.current || connectionRef.current === "failed" || connectionRef.current === "disconnected") return;
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
    let connectFailure: { generation: number; eventId: string } | null = null;
    const join = async () => {
      if (!current() || joining || blocked.current || endingRef.current) return;
      joining = true;
      changeConnection("connecting");
      setError(null);
      setPhase(null); evidenceInterrupted = false; recoveryPaused.current = false;
      const controller = new AbortController(); requests.current.add(controller);
      let connectionError = "Could not connect. Check your connection and try reconnecting. Your draft is kept here.";
      try {
        let res: Response | null = null;
        // A multi-profile server can return 202 while it waits for a named
        // worker or moves this same conversation to another LiveKit project.
        // Each request is bounded; the participant never selects a profile.
        const preparationDeadline = Date.now() + (realSession ? 10 * 60_000 : 15_000);
        do {
          const report = connectFailure;
          res = await fetch(tokenEndpoint, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(realSession
              ? report ? { failedTransportGeneration: report.generation, failureEventId: report.eventId } : {}
              : { roomName, identity, resume: hasConnected }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(realSession ? 150_000 : 15_000)]),
          });
          if (!current() || controller.signal.aborted) return;
          if (report && (res.ok || res.status === 202)) connectFailure = null;
          if (res.status !== 202) break;
          await abortableWait(1000, controller.signal);
        } while (current() && Date.now() < preparationDeadline);
        if (res?.status === 503 && realSession) {
          connectionError = "An interview worker is unavailable right now. Your conversation and draft are saved. Try reconnecting.";
        }
        if (!res || res.status === 202 || !res.ok) {
          const body = await res?.json().catch(() => ({})) as { code?: string } | undefined;
          const kind = lifecycleError(res?.status ?? 503, body?.code);
          if (realSession && kind !== "retry") {
            await fetchRecovery().catch(() => {});
            if (!current()) return;
            if (!terminalInterview(lifecycleRef.current?.status ?? "")) {
              blocked.current = true; setPhase(kind === "expired" ? "expired" : "unavailable");
              if (kind === "expired") clearDraft();
            }
            clearTurn(); changeConnection("disconnected"); return;
          }
          throw new Error("Could not reach the interview server.");
        }
        const { serverUrl, token, transportGeneration, writer } = await res.json() as { serverUrl: string; token: string;
          transportGeneration?: number; writer?: string };
        if (!current()) return;
        recoveryRequested.current = writer === "recovering";
        if (typeof transportGeneration === "number") {
          if (transport.current !== null && transportGeneration > transport.current) setPhase("switching");
          transport.current = transportGeneration;
        }
        // LiveKit's Room instance owns only the active transport. Reusing it
        // after a failed join keeps transcript/draft and all event handlers.
        if (room.state && room.state !== ConnectionState.Disconnected) await room.disconnect();
        try {
          await room.connect(serverUrl, token);
        } catch (connectError) {
          if (realSession && !hasConnected && typeof transportGeneration === "number" &&
              providerConnectFailure(connectError)) {
            connectFailure = { generation: transportGeneration, eventId: crypto.randomUUID() };
          }
          throw connectError;
        }
        if (!current()) { void room.disconnect(); return; }
        setIsActive(true);
        hasConnected = true;
        changeConnection("connected");
        setPhase(null);
        if (realSession) void fetchRecovery().catch(() => setError("Could not reload saved conversation. Your draft remains here."));
        if (!realSession && !openingExpected && !pendingTurn.current && !knownAiSegments.current.size) expectResponse(true);
        updateAgent();
        if (desiredMic.current && !blocked.current) {
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
        setError(connectionError);
      } finally {
        requests.current.delete(controller);
        joining = false;
      }
    };
    reconnectRef.current = join;
    await join();
  }, [changeConnection, detachAudio, expectResponse, tokenEndpoint, realSession, fetchRecovery, clearTurn, clearDraft]);

  const reconnect = useCallback(async () => {
    if (blocked.current || endingRef.current) return;
    if (connectionRef.current === "connected" && !agentIdentity.current) {
      setPhase("recovering");
      // An explicit resume is allowed to request the replacement even when
      // the saved status is interrupted; token issuance performs that check.
      await reconnectRef.current?.(); return;
    }
    if (connectionRef.current === "failed" || connectionRef.current === "disconnected") {
      await reconnectRef.current?.();
    }
  }, []);

  const setMicrophone = useCallback(async (enabled: boolean) => {
    const room = roomRef.current;
    if (!room || blocked.current || endingRef.current || !agentReady || connectionRef.current !== "connected" || room.state !== ConnectionState.Connected || micBusyRef.current) return false;
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
  }, [agentReady]);

  // Typed messages and on-screen answers share one chat path, so the agent sees one conversation.
  const sendChat = useCallback(async (
    wire: string, shown: Pick<TranscriptMessage, "text" | "source">, failure: string,
  ) => {
    reconcileRef.current?.();
    const room = roomRef.current;
    if (!wire.trim() || !room || blocked.current || endingRef.current || connectionRef.current !== "connected" || room.state !== ConnectionState.Connected || !agentReady || sendingRef.current) return false;
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
      const pending = realSession ? pendingEvidence.current?.wire === wire ? pendingEvidence.current
        : storedDraft.current?.text.trim() === wire
          ? { id: storedDraft.current.eventId, wire, at: storedDraft.current.at }
          : { id: crypto.randomUUID(), wire, at: new Date().toISOString() } : null;
      if (pending) {
        pendingEvidence.current = pending;
        if (initialRecovery) {
          const record = { text: wire, eventId: pending.id, at: pending.at, pending: true };
          storedDraft.current = record;
          sessionStorage.setItem(draftStorageKey(initialRecovery.sessionKey), JSON.stringify(record));
          setDraftLocked(true);
        }
      }
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
        clearDraft();
        await fetchRecovery().catch(() => {});
      }
      // LiveKit does not echo outgoing chat messages to their sender.
      if (!realSession) setMessages((previous) => upsertTranscript(previous, {
        id: transcriptId(room.localParticipant.identity, info.id),
        speaker: "participant", isFinal: true, ...shown,
      }));
      // A fast agent may answer before sendText settles. Do not wait again for
      // a response already received, or mistake an older greeting for that reply.
      const savedTurn = pending && canonicalRef.current.find(message => message.eventKey === `text:${pending.id}`);
      const savedReply = savedTurn && canonicalRef.current.some(message => message.speaker === "interviewer" && message.sequence > savedTurn.sequence);
      if (!savedReply && ![...completedAiSegments.current].some((id) => !precedingAiSegments.has(id))) {
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
  }, [agentReady, expectResponse, realSession, initialRecovery, clearDraft, fetchRecovery]);

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

  const endInterview = useCallback(async () => {
    if (!realSession || blocked.current || endingRef.current) return false;
    endingRef.current = true; setEnding(true); setError(null);
    const controller = new AbortController(); requests.current.add(controller);
    const epoch = generation.current;
    try {
      const response = await fetch("/interview/api/end", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: "{}",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const result = await response.json() as { status?: string; endReason?: RecoverySnapshot["endReason"] };
      if (controller.signal.aborted || epoch !== generation.current) return false;
      if (response.status === 401) {
        blocked.current = true; setPhase("expired"); clearDraft(); clearTurn();
        void roomRef.current?.disconnect(); return false;
      }
      if (!response.ok || !result.status || !terminalInterview(result.status)) throw new Error("Ending was not confirmed");
      // Only the canonical server result closes the interview. Cancellation
      // can win a concurrent participant-end request.
      lifecycleRef.current = { ...lifecycleRef.current!, status: result.status, endReason: result.endReason };
      blocked.current = true; setRecoveryStatus(result.status); setEndReason(result.endReason ?? null);
      clearDraft(); clearTurn(); recoveryPoll.current?.abort(); setAgentReady(false); setMicEnabled(false);
      void roomRef.current?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      void roomRef.current?.disconnect();
      await fetchRecovery().catch(() => {});
      return true;
    } catch {
      if (!controller.signal.aborted && epoch === generation.current) setError("The interview could not be ended right now. Please try again. Your conversation is kept here.");
      return false;
    } finally {
      requests.current.delete(controller); endingRef.current = false;
      if (epoch === generation.current) setEnding(false);
    }
  }, [realSession, clearDraft, clearTurn, fetchRecovery]);

  const participantStatus: InterviewStatus = terminalInterview(recoveryStatus) ? recoveryStatus === "failed" ? "unavailable" : recoveryStatus as InterviewStatus
    : phase === "expired" ? "expired" : phase === "unavailable" ? "unavailable"
    : phase === "switching" ? "switching" : phase === "recovering" ? "recovering"
    : phase === "interrupted" ? "interrupted" : phase === "reply_uncertain" ? "ready"
    : connection === "connected"
    ? turn === "delayed" ? "delayed"
      : turn === "responding" ? "speaking"
      : turn && status !== "thinking" ? "waiting"
      : status === "listening" && !micEnabled ? "ready" : status
    : status;
  return { status: participantStatus, connection, turn, messages, provisional, draft, draftLocked, setDraft, discardDraft: clearDraft,
    recoveryStatus, replyUnconfirmed, controlPending, legacyHistory, phase, endReason, ending, endInterview,
    readOnly: terminalInterview(recoveryStatus) || phase === "expired" || phase === "unavailable",
    error, isActive, agentReady, micEnabled, micBusy, sending,
    visualReady, voiceAvailable,
    audioBlocked, display, displayResponse, start, stop, reconnect, setMicrophone, sendText, respondToDisplay, enableAudio };
}

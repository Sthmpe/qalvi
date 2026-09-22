import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Objects built inside the vm realm have a different prototype, so compare plain values.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

// Exercise the actual TS modules without adding a test framework or build artifacts.
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, ...globals });
  return exports;
}
const transcript = load("../src/components/interview/transcription.ts");
const { upsertTranscript, readTranscript, transcriptId } = transcript;
const display = load("../src/components/interview/visuals/display.ts");

function reader(streamId, segment, chunks, final = "false", trailer) {
  return {
    info: { id: streamId, attributes: { ...(segment ? { "lk.segment_id": segment } : {}), "lk.transcription_final": final } },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
      if (trailer) this.info.attributes["lk.transcription_final"] = trailer;
    },
  };
}

test("participant interim and final streams replace one stable segment", async () => {
  let messages = [];
  const update = (message) => { messages = upsertTranscript(messages, message); };
  await readTranscript(reader("1", "segment", ["I use"]), "user", "participant", 1, update);
  await readTranscript(reader("2", "segment", ["I use ", "a spreadsheet"], "true"), "user", "participant", 2, update);
  await readTranscript(reader("3", "segment", ["I use a spreadsheet"], "true"), "user", "participant", 3, update);
  await readTranscript(reader("4", "segment", ["I use"]), "user", "participant", 4, update);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "I use a spreadsheet");
  assert.equal(messages[0].isFinal, true);
});

test("agent deltas render progressively and finalize using trailer metadata", async () => {
  const updates = [];
  await readTranscript(reader("1", "agent-segment", ["Tell ", "me more"], "false", "true"), "agent", "ai", 1, (m) => updates.push(m));
  assert.equal(updates[0].text, "Tell ");
  assert.equal(updates[1].text, "Tell me more");
  assert.equal(updates[1].isFinal, false);
  assert.equal(updates[2].isFinal, true);
});

test("late interim revisions cannot regress text; distinct utterances retain repeated words", () => {
  const id = transcriptId("user", "a");
  let messages = upsertTranscript([], { id, text: "Newer text", revision: 2 });
  messages = upsertTranscript(messages, { id, text: "Old", revision: 1 });
  assert.equal(messages[0].text, "Newer text");
  messages = upsertTranscript(messages, { id, text: "Yes", isFinal: true });
  messages = upsertTranscript(messages, { id: transcriptId("user", "b"), text: "Yes", isFinal: true });
  messages = upsertTranscript(messages, { id: transcriptId("other", "b"), text: "Yes", isFinal: true });
  assert.equal(messages.length, 3);
});

test("stream ID is the fallback, never transcript text", async () => {
  const messages = [];
  await readTranscript(reader("stream-a", null, ["Yes"], "true"), "user", "participant", 1, (m) => messages.push(m));
  assert.equal(messages[0].id, transcriptId("user", "stream-a"));
});

function sessionHarness() {
  const slots = [];
  let cursor = 0;
  const rooms = [];
  const requests = [];
  let now = 0;
  const intervals = new Map();
  let timerId = 0;
  class Room {
    constructor() {
      rooms.push(this);
      this.handlers = new Map();
      this.engine = { isClosed: false, verifyTransport: () => this.transportHealthy !== false };
      this.remoteParticipants = new Map([["agent", { isAgent: true, attributes: { "lk.agent.state": "listening" } }]]);
      this.localParticipant = {
        identity: "user", microphone: false, sent: [],
        get isMicrophoneEnabled() { return this.microphone; },
        setMicrophoneEnabled: async (enabled) => { this.localParticipant.microphone = enabled; },
        sendText: async (text, options) => {
          if (this.failSend) throw new Error("offline");
          this.localParticipant.sent.push({ text, options });
          return { id: `chat-${this.localParticipant.sent.length}` };
        },
      };
    }
    on(event, callback) { this.handlers.set(event, callback); }
    registerTextStreamHandler(topic, handler) {
      assert.ok(["lk.transcription", "qalvi.display"].includes(topic), `Unexpected topic ${topic}`);
      if (topic === "lk.transcription") this.transcription = handler;
      else this.display = handler;
    }
    async startAudio() {}
    async connect() { if (this.failConnect) throw new Error("offline"); this.engine.isClosed = false; this.state = "connected"; }
    async disconnect() { this.disconnected = true; }
  }
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (callback) => callback,
    useEffect: () => {},
  };
  const livekit = { Room, RoomEvent: new Proxy({}, { get: (_, key) => key }), Track: { Kind: { Audio: "audio" } }, ConnectionState: { Connected: "connected", Reconnecting: "reconnecting", SignalReconnecting: "signalReconnecting", Disconnected: "disconnected", Connecting: "connecting" } };
  const health = load("../src/components/interview/sessionHealth.ts", { "livekit-client": livekit });
  // The test harness supplies hook storage; no React renderer is involved.
  const { useLiveKitSession: runHook } = load("../src/components/interview/useLiveKitSession.ts", {
    react, "./transcription": transcript, "./visuals/display": display, "./sessionHealth": health,
    "livekit-client": livekit,
  }, {
    performance, crypto, console, setTimeout, clearTimeout, AbortSignal, process: { env: { NODE_ENV: "test" } },
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn) => { const id = ++timerId; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    fetch: async (_, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ serverUrl: "mock", token: "mock" }) }; },
  });
  return { rooms, requests, tick: (ms = 1000) => { now += ms; for (const fn of intervals.values()) fn(); }, render: () => { cursor = 0; return runHook(); } };
}

test("signaling recovery never shows listening and preserves evidence and the active visual", async () => {
  const h = sessionHarness();
  await h.render().start("voice");
  const room = h.rooms[0];
  await room.transcription(reader("1", "a", ["My answer"], "true"), { identity: "user" });
  await room.display(displayStream(cards));
  room.handlers.get("SignalReconnecting")();
  room.handlers.get("ParticipantConnected")();
  assert.equal(h.render().status, "reconnecting");
  assert.equal(h.render().agentReady, false);
  assert.equal(await h.render().sendText("offline draft"), false);
  assert.equal(h.render().messages.length, 1);
  same(h.render().display, cards);
  room.handlers.get("Reconnected")();
  assert.equal(h.render().connection, "connected");
  assert.equal(h.render().status, "waiting");
  await room.transcription(reader("2", "a", ["My answer"], "true"), { identity: "user" });
  assert.equal(h.render().messages.length, 1);
  assert.equal(h.render().micEnabled, true);
  assert.equal(h.rooms.length, 1);
});

test("terminal failure retains history, retries the original room, and refuses stale visuals", async () => {
  const h = sessionHarness();
  await h.render().start("text");
  const room = h.rooms[0];
  await h.render().sendText("Existing evidence");
  await room.display(displayStream(cards));
  room.state = "disconnected";
  room.handlers.get("Disconnected")();
  assert.equal(h.render().status, "failed");
  assert.equal(h.render().isActive, true);
  assert.equal(h.render().messages.length, 1);
  same(h.render().display, cards);
  room.failConnect = true;
  await h.render().reconnect();
  assert.equal(h.render().connection, "failed");
  room.failConnect = false;
  await h.render().reconnect();
  assert.equal(h.render().connection, "connected");
  assert.equal(h.render().messages.length, 1);
  assert.equal(h.rooms.length, 1);
  assert.equal(h.requests[0].roomName, h.requests[2].roomName);
  assert.equal(h.requests[0].identity, h.requests[2].identity);
  assert.equal(h.requests[0].resume, false);
  assert.equal(h.requests[2].resume, true);
  assert.equal(await h.render().respondToDisplay({ actionId: cards.id, type: cards.type, optionId: "a" }), false);
});

test("an interrupted pending send releases controls without recording success or resending", async () => {
  const h = sessionHarness();
  await h.render().start("text");
  const room = h.rooms[0];
  let finish;
  room.localParticipant.sendText = () => new Promise((resolve) => { finish = resolve; });
  const sending = h.render().sendText("Keep this draft");
  room.handlers.get("SignalReconnecting")();
  assert.equal(await sending, false);
  assert.equal(h.render().sending, false);
  finish({ id: "late-send" });
  room.handlers.get("Reconnected")();
  await Promise.resolve();
  assert.equal(h.render().messages.length, 0);
  assert.match(h.render().error, /Delivery could not be confirmed/);
});

test("composer preserves offline and failed drafts, clears only successful unchanged text", async () => {
  const slots = []; let cursor = 0;
  let coarsePointer = false;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useLayoutEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  const { default: Controls } = load("../src/components/interview/InterviewControls.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx } }, { window: { matchMedia: () => ({ matches: coarsePointer }) } });
  const props = { started: true, connected: true, status: "listening", mode: "text", onSendText: async () => false };
  const render = () => { cursor = 0; return Controls(props); };
  const find = (node, type) => !node || typeof node !== "object" ? undefined : node.type === type ? node : [node.props?.children].flat().map(child => find(child, type)).find(Boolean);
  find(render(), "textarea").props.onChange({ target: { value: "Draft" } });
  await find(render(), "form").props.onSubmit({ preventDefault() {} });
  assert.equal(find(render(), "textarea").props.value, "Draft");
  props.connected = false; props.status = "reconnecting";
  assert.equal(find(render(), "textarea").props.value, "Draft");
  assert.equal(find(render(), "button").props.disabled, true);
  props.status = "failed"; props.mode = "voice";
  assert.equal(find(render(), "textarea").props.value, "Draft");
  props.mode = "text";
  props.connected = true;
  let finish; props.onSendText = () => new Promise(resolve => { finish = resolve; });
  const send = find(render(), "form").props.onSubmit({ preventDefault() {} });
  find(render(), "textarea").props.onChange({ target: { value: "Next draft" } });
  finish(true); await send;
  assert.equal(find(render(), "textarea").props.value, "Next draft");
  props.onSendText = async () => true;
  await find(render(), "form").props.onSubmit({ preventDefault() {} });
  assert.equal(find(render(), "textarea").props.value, "");
  assert.equal(find(render(), "button").props["aria-label"], "Use microphone");
  const key = { key: "Enter", nativeEvent: { isComposing: false }, preventDefault() { throw new Error("Must allow a newline"); } };
  coarsePointer = true;
  find(render(), "textarea").props.onKeyDown(key);
  coarsePointer = false;
  find(render(), "textarea").props.onKeyDown({ ...key, shiftKey: true });
  find(render(), "textarea").props.onKeyDown({ ...key, nativeEvent: { isComposing: true } });
});

test("mic-off is Ready, sent turns wait, and missing responses become delayed without resending", async () => {
  const h = sessionHarness();
  await h.render().start("text");
  const room = h.rooms[0];
  assert.equal(h.render().turn, "opening");
  await room.transcription(reader("g", "greeting", ["Hello, what brings you here?"], "true"), { identity: "agent" });
  assert.equal(h.render().status, "ready");
  await h.render().setMicrophone(true);
  assert.equal(h.render().status, "listening");
  await h.render().setMicrophone(false);
  assert.equal(h.render().status, "ready");
  assert.equal(await h.render().sendText("My answer"), true);
  assert.equal(h.render().status, "waiting");
  assert.equal(h.render().messages.length, 2);
  h.tick(20000);
  assert.equal(h.render().status, "delayed");
  // Replayed greeting cannot count as a response to the new participant turn.
  await room.transcription(reader("g2", "greeting", ["Hello, what brings you here?"], "true"), { identity: "agent" });
  assert.equal(h.render().status, "delayed");
  await room.transcription(reader("r", "reply", ["Tell me more"], "false"), { identity: "agent" });
  assert.equal(h.render().turn, "responding");
  await room.transcription(reader("r2", "reply", ["Tell me more"], "true"), { identity: "agent" });
  assert.equal(h.render().status, "ready");
  assert.equal(room.localParticipant.sent.length, 1);
});

test("closed engine with a connected Room fails safely after a sent turn", async () => {
  const h = sessionHarness();
  await h.render().start("voice");
  const room = h.rooms[0];
  await h.render().sendText("Keep this evidence");
  room.engine.isClosed = true;
  room.transportHealthy = false;
  h.tick();
  assert.equal(h.render().connection, "failed");
  assert.equal(h.render().status, "failed");
  assert.equal(h.render().messages[0].text, "Keep this evidence");
  assert.equal(await h.render().sendText("Do not send"), false);
  assert.equal(room.localParticipant.sent.length, 1);
  await h.render().reconnect();
  assert.equal(h.render().messages.length, 1);
  assert.equal(h.render().turn, "waiting");
});

test("transport mismatch shows recovery, while SDK and stable transcript IDs own resumption", async () => {
  const h = sessionHarness();
  await h.render().start("voice");
  const room = h.rooms[0];
  await room.transcription(reader("s", "speech", ["Spoken answer"], "true"), { identity: "user" });
  assert.equal(h.render().status, "waiting");
  room.transportHealthy = false;
  h.tick();
  assert.equal(h.render().status, "reconnecting");
  room.transportHealthy = true;
  h.tick();
  assert.equal(h.render().status, "waiting");
  await room.transcription(reader("s2", "speech", ["Spoken answer"], "true"), { identity: "user" });
  assert.equal(h.render().messages.length, 1);
  h.tick(20000);
  assert.equal(h.render().status, "delayed");
  assert.equal(room.localParticipant.sent.length, 0);
  h.render().stop();
  h.tick();
  assert.equal(h.render().status, "idle");
});

test("a fast reply received before send completion does not leave a false pending turn", async () => {
  const h = sessionHarness();
  await h.render().start("text");
  const room = h.rooms[0];
  room.localParticipant.sendText = async () => {
    await room.transcription(reader("r", "fast", ["Thanks for sharing"], "true"), { identity: "agent" });
    return { id: "sent" };
  };
  assert.equal(await h.render().sendText("My answer"), true);
  h.tick(30000);
  assert.equal(h.render().turn, null);
  assert.equal(h.render().status, "ready");
  assert.equal(h.render().messages.length, 2);
});

test("readiness is checked before send and an ended replacement session cannot look ready", async () => {
  const h = sessionHarness();
  await h.render().start("text");
  const room = h.rooms[0];
  room.engine.isClosed = true;
  assert.equal(await h.render().sendText("Do not lose this draft"), false);
  assert.equal(h.render().status, "failed");
  assert.equal(room.localParticipant.sent.length, 0);
  await h.render().reconnect();
  const agent = room.remoteParticipants.get("agent");
  agent.attributes["qalvi.session.status"] = "unavailable";
  room.handlers.get("ParticipantAttributesChanged")({ "qalvi.session.status": "unavailable" }, agent);
  room.handlers.get("Disconnected")();
  assert.equal(h.render().status, "failed");
  assert.match(h.render().error, /cannot be resumed/);
});

test("a silent interviewer is not a lost connection: the interview continues in text", async () => {
  const h = sessionHarness();
  await h.render().start("voice");
  const room = h.rooms[0];
  const agent = room.remoteParticipants.get("agent");
  await room.transcription(reader("g", "g", ["Hello there"], "true"), { identity: "agent" });
  assert.equal(h.render().voiceAvailable, true);

  agent.attributes["qalvi.voice"] = "unavailable";
  room.handlers.get("ParticipantAttributesChanged")({ "qalvi.voice": "unavailable" }, agent);

  assert.equal(h.render().voiceAvailable, false);
  // Nothing about the session itself degrades.
  assert.equal(h.render().connection, "connected");
  assert.notEqual(h.render().status, "failed");
  assert.equal(h.render().error, null);
  assert.equal(h.render().agentReady, true);
  assert.equal(h.render().micEnabled, true);

  // The assistant's words still arrive, and the next participant turn still works.
  await room.transcription(reader("s", "s", ["What happened next?"], "true"), { identity: "agent" });
  assert.equal(await h.render().sendText("It got busier"), true);
  assert.equal(room.localParticipant.sent.length, 1);
  assert.equal(h.render().messages.length, 3);
  assert.equal(h.render().messages.filter((m) => m.speaker === "participant").length, 1);
  await room.display(displayStream(cards));
  same(h.render().display, cards);
});

test("voice availability resets for a new interview and survives an unrelated attribute update", async () => {
  const h = sessionHarness();
  await h.render().start("text");
  const room = h.rooms[0];
  const agent = room.remoteParticipants.get("agent");
  agent.attributes["qalvi.voice"] = "unavailable";
  room.handlers.get("ParticipantAttributesChanged")({ "qalvi.voice": "unavailable" }, agent);
  assert.equal(h.render().voiceAvailable, false);
  agent.attributes["lk.agent.state"] = "thinking";
  room.handlers.get("ParticipantAttributesChanged")({ "lk.agent.state": "thinking" }, agent);
  assert.equal(h.render().voiceAvailable, false);
  h.render().stop();
  await h.render().start("text");
  assert.equal(h.render().voiceAvailable, true);
});

test("SDK microphone changes are reflected even without an agent state update", async () => {
  const h = sessionHarness();
  await h.render().start("voice");
  const room = h.rooms[0];
  await room.transcription(reader("g", "g", ["Hello"], "true"), { identity: "agent" });
  assert.equal(h.render().status, "listening");
  room.localParticipant.microphone = false;
  h.tick();
  assert.equal(h.render().status, "ready");
});

test("reconciliation refreshes agent readiness even when no connection event was delivered", async () => {
  const h = sessionHarness();
  await h.render().start("text");
  const room = h.rooms[0];
  const agent = room.remoteParticipants.get("agent");
  agent.attributes["lk.agent.state"] = "initializing";
  room.handlers.get("ParticipantConnected")();
  assert.equal(h.render().agentReady, false);
  agent.attributes["lk.agent.state"] = "listening";
  h.tick();
  assert.equal(h.render().agentReady, true);
  assert.equal(room.localParticipant.sent.length, 0);
});

test("voice to text to voice uses the same live room and preserves transcript context", async () => {
  const harness = sessionHarness();
  await harness.render().start("voice");
  const room = harness.rooms[0];
  await room.transcription(reader("1", "a", ["Voice answer"], "true"), { identity: "user" });
  assert.equal(await harness.render().setMicrophone(false), true);
  assert.equal(await harness.render().sendText("Typed answer"), true);
  assert.equal(room.localParticipant.sent[0].options.topic, "lk.chat");
  assert.equal(await harness.render().setMicrophone(true), true);
  assert.equal(harness.rooms.length, 1);
  assert.equal(room.disconnected, undefined);
  assert.equal(harness.render().messages.length, 2);
});

test("text-first needs no microphone; failed sends preserve history and allow retry", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const room = harness.rooms[0];
  assert.equal(room.localParticipant.microphone, false);
  room.failSend = true;
  assert.equal(await harness.render().sendText("draft"), false);
  assert.equal(harness.render().messages.length, 0);
  room.failSend = false;
  assert.equal(await harness.render().sendText("draft"), true);
  assert.equal(harness.render().messages.length, 1);
});

const displayStream = (payload) => ({ info: { id: "display-1" }, readAll: async () => JSON.stringify(payload) });
const cards = { type: "comparison_cards", id: "cards-1", prompt: "Which?", options: [
  { id: "a", label: "Option A", description: "First" }, { id: "b", label: "Option B", description: "Second" },
] };

test("a valid display action appears on stage; malformed or unknown actions are ignored", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const room = harness.rooms[0];
  await room.display({ info: { id: "x" }, readAll: async () => "not json" }, { identity: "agent" });
  await room.display(displayStream({ ...cards, type: "iframe" }), { identity: "agent" });
  assert.equal(harness.render().display, null);
  await room.display(displayStream(cards), { identity: "agent" });
  same(harness.render().display, cards);
  assert.equal(harness.render().displayResponse, null);
});

test("an on-screen answer travels over the same chat path, is recorded as evidence, and locks the visual", async () => {
  const harness = sessionHarness();
  await harness.render().start("voice");
  const room = harness.rooms[0];
  await room.display(displayStream(cards), { identity: "agent" });
  assert.equal(await harness.render().respondToDisplay({ actionId: "cards-1", type: "comparison_cards", optionId: "zzz" }), false);
  assert.equal(await harness.render().respondToDisplay({ actionId: "cards-1", type: "comparison_cards", optionId: "b" }), true);
  same(room.localParticipant.sent[0], { text: '[On screen] Chose "Option B"', options: { topic: "lk.chat" } });
  const [message] = harness.render().messages;
  assert.equal(message.speaker, "participant");
  assert.equal(message.text, 'Chose "Option B"');
  assert.equal(message.source, "visual");
  assert.equal(message.isFinal, true);
  same(harness.render().displayResponse, { actionId: "cards-1", type: "comparison_cards", optionId: "b" });
  assert.equal(await harness.render().respondToDisplay({ actionId: "cards-1", type: "comparison_cards", optionId: "a" }), false);
  assert.equal(room.localParticipant.sent.length, 1);
  assert.equal(harness.rooms.length, 1);
});

test("a failed on-screen answer leaves the visual open for retry; a new action replaces the old one", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const room = harness.rooms[0];
  await room.display(displayStream(cards), { identity: "agent" });
  room.failSend = true;
  assert.equal(await harness.render().respondToDisplay({ actionId: "cards-1", type: "comparison_cards", optionId: "a" }), false);
  assert.equal(harness.render().displayResponse, null);
  assert.equal(harness.render().messages.length, 0);
  room.failSend = false;
  assert.equal(await harness.render().respondToDisplay({ actionId: "cards-1", type: "comparison_cards", optionId: "a" }), true);
  const slider = { type: "slider", id: "slider-1", prompt: "How much?", min: 0, max: 10, step: 1, initial: 5 };
  await room.display(displayStream(slider), { identity: "agent" });
  same(harness.render().display, slider);
  assert.equal(harness.render().displayResponse, null);
  harness.render().stop();
  assert.equal(harness.render().display, null);
});

test("a null payload takes the visual off the screen and a later answer to it is refused", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const room = harness.rooms[0];
  await room.display(displayStream(cards), { identity: "agent" });
  same(harness.render().display, cards);
  await room.display(displayStream(null), { identity: "agent" });
  assert.equal(harness.render().display, null);
  assert.equal(await harness.render().respondToDisplay({ actionId: "cards-1", type: "comparison_cards", optionId: "a" }), false);
  assert.equal(room.localParticipant.sent.length, 0);
});

test("display actions from a disconnected room cannot reach the next interview", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const staleRoom = harness.rooms[0];
  harness.render().stop();
  await harness.render().start("text");
  await staleRoom.display(displayStream(cards), { identity: "agent" });
  assert.equal(harness.render().display, null);
});

test("replayed visuals and stale callbacks cannot submit an answer twice", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const room = harness.rooms[0];
  await room.display(displayStream(cards), { identity: "agent" });
  const staleRespond = harness.render().respondToDisplay;
  const answer = { actionId: cards.id, type: "comparison_cards", optionId: "a" };
  assert.equal(await staleRespond(answer), true);
  await room.display(displayStream(cards), { identity: "agent" });
  same(harness.render().displayResponse, answer);
  assert.equal(await staleRespond(answer), false);
  const next = { ...cards, id: "cards-2" };
  await room.display(displayStream(next), { identity: "agent" });
  assert.equal(await staleRespond(answer), false);
  await room.display(displayStream(cards), { identity: "agent" });
  assert.equal(harness.render().display.id, next.id);
  assert.equal(room.localParticipant.sent.length, 1);
});

test("an in-flight answer locks only its own visual after a successful send", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const room = harness.rooms[0];
  await room.display(displayStream(cards), { identity: "agent" });
  let finish;
  room.localParticipant.sendText = () => new Promise((resolve) => { finish = resolve; });
  const answer = { actionId: cards.id, type: "comparison_cards", optionId: "a" };
  const pending = harness.render().respondToDisplay(answer);
  assert.equal(harness.render().displayResponse, null);
  assert.equal(await harness.render().respondToDisplay(answer), false);
  await room.display(displayStream({ ...cards, id: "next" }), { identity: "agent" });
  finish({ id: "sent" });
  assert.equal(await pending, true);
  assert.equal(harness.render().display.id, "next");
  assert.equal(harness.render().displayResponse, null);
  assert.equal(harness.render().messages.length, 1);
});

test("transcription callbacks from a disconnected room cannot leak into the next interview", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const staleRoom = harness.rooms[0];
  harness.render().stop();
  await harness.render().start("text");
  await staleRoom.transcription(reader("1", "a", ["Stale text"], "true"), { identity: "user" });
  assert.equal(harness.render().messages.length, 0);
});

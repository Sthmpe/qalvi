import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual TS modules without adding a test framework or build artifacts.
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, ...globals });
  return exports;
}
const transcript = load("../src/components/interview/transcription.ts");
const { upsertTranscript, readTranscript, transcriptId } = transcript;

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
  class Room {
    constructor() {
      rooms.push(this);
      this.handlers = new Map();
      this.remoteParticipants = new Map([["agent", { isAgent: true, attributes: { "lk.agent.state": "listening" } }]]);
      this.localParticipant = {
        identity: "user", microphone: false, sent: [],
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
      assert.equal(topic, "lk.transcription");
      this.transcription = handler;
    }
    async startAudio() {}
    async connect() { this.state = "connected"; }
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
  // The test harness supplies hook storage; no React renderer is involved.
  const { useLiveKitSession: runHook } = load("../src/components/interview/useLiveKitSession.ts", {
    react, "./transcription": transcript,
    "livekit-client": { Room, RoomEvent: new Proxy({}, { get: (_, key) => key }), Track: { Kind: { Audio: "audio" } }, ConnectionState: { Connected: "connected" } },
  }, {
    performance, crypto, console, process: { env: { NODE_ENV: "test" } },
    fetch: async () => ({ ok: true, json: async () => ({ serverUrl: "mock", token: "mock" }) }),
  });
  return { rooms, render: () => { cursor = 0; return runHook(); } };
}

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

test("transcription callbacks from a disconnected room cannot leak into the next interview", async () => {
  const harness = sessionHarness();
  await harness.render().start("text");
  const staleRoom = harness.rooms[0];
  harness.render().stop();
  await harness.render().start("text");
  await staleRoom.transcription(reader("1", "a", ["Stale text"], "true"), { identity: "user" });
  assert.equal(harness.render().messages.length, 0);
});

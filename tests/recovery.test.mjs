import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/interview/recovery.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports });
const { canonicalTranscript, mergeCanonical, readStoredDraft, reconcileStoredDraft, terminalInterview } = exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("canonical database ID and sequence own transcript identity and order", () => {
  const first = { id: "a", sequence: 0, speaker: "interviewer", channel: "voice", content: "Hello", eventKey: "assistant:a" };
  const answer = { id: "b", sequence: 1, speaker: "participant", channel: "text", content: "Hi", eventKey: "text:stable" };
  const merged = mergeCanonical([answer], [first, answer]);
  assert.deepEqual(plain(merged.map((message) => message.id)), ["a", "b"]);
  assert.deepEqual(plain(canonicalTranscript(merged).map(({ id, speaker, text }) => ({ id, speaker, text }))), [
    { id: "a", speaker: "ai", text: "Hello" }, { id: "b", speaker: "participant", text: "Hi" },
  ]);
});

test("tab draft retains its stable event ID for explicit retry", () => {
  const eventId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(plain(readStoredDraft(JSON.stringify({ text: "My answer", eventId,
    at: "2026-09-27T00:00:00Z", pending: true }))),
    { text: "My answer", eventId, at: "2026-09-27T00:00:00Z", pending: true });
  const pending = readStoredDraft(JSON.stringify({ text: "My answer", eventId,
    at: "2026-09-27T00:00:00Z", pending: true }));
  assert.equal(reconcileStoredDraft(pending, [], "in_progress").eventId, eventId);
  assert.equal(reconcileStoredDraft(pending, [{ eventKey: `text:${eventId}` }], "in_progress"), null);
  assert.equal(reconcileStoredDraft(pending, [], "cancelled"), null);
  assert.equal(readStoredDraft('{bad'), null);
  assert.equal(terminalInterview("completed"), true);
  assert.equal(terminalInterview("cancelled"), true);
  assert.equal(terminalInterview("interrupted"), false);
});

const lifecycleCompiled = ts.transpileModule(readFileSync(new URL("../src/components/interview/lifecycle.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const lifecycle = {};
vm.runInNewContext(lifecycleCompiled, { exports: lifecycle, Date, setTimeout, clearTimeout });

test("recovery mode only expects fresh greetings or an explicitly recovered answer", () => {
  assert.equal(lifecycle.recoveryExpectation("fresh"), "opening");
  assert.equal(lifecycle.recoveryExpectation("answering"), "waiting");
  for (const mode of ["resumed", "reply_uncertain", undefined]) assert.equal(lifecycle.recoveryExpectation(mode), null);
});

test("recovery polls 202 every two seconds; active alone never declares readiness", async () => {
  let time = 0, joined = false, calls = 0;
  const waits = [], errors = [];
  await lifecycle.pollInterviewerRecovery({ signal: new AbortController().signal,
    ready: () => joined, now: () => time,
    request: async () => ({ status: ++calls < 3 ? 202 : 200 }),
    wait: async (ms) => { waits.push(ms); time += ms; if (calls === 4) joined = true; },
    onError: error => errors.push(error) });
  assert.equal(calls, 4);
  assert.deepEqual(waits, [2000, 2000, 2000, 2000]);
  assert.deepEqual(errors, []);
});

test("recovery cancels stale work and is bounded even if every RPC says active", async () => {
  const controller = new AbortController(); let calls = 0;
  await lifecycle.pollInterviewerRecovery({ signal: controller.signal, ready: () => false,
    request: async () => { calls++; controller.abort(); return { status: 202 }; },
    onError: () => assert.fail("Aborted work cannot mutate lifecycle state") });
  assert.equal(calls, 1);
  let time = 0; const errors = [];
  await lifecycle.pollInterviewerRecovery({ signal: new AbortController().signal, ready: () => false,
    budgetMs: 6000, now: () => time, request: async () => ({ status: 200 }),
    wait: async (ms) => { time += ms; }, onError: error => errors.push(error) });
  assert.equal(time, 6000); assert.deepEqual(errors, ["retry"]);
});

test("expired, ended and exhausted recovery stop; temporary failures have bounded backoff", async () => {
  for (const [status, code, expected] of [[401, "session_unavailable", "expired"], [410, "session_ended", "ended"],
    [503, "recovery_unavailable", "unavailable"], [409, "not_recoverable", "unavailable"], [501, "recovery_unsupported", "unavailable"]]) {
    const errors = []; let calls = 0;
    await lifecycle.pollInterviewerRecovery({ signal: new AbortController().signal, ready: () => false,
      request: async () => { calls++; return { status, code }; }, onError: error => errors.push(error) });
    assert.equal(calls, 1); assert.deepEqual(errors, [expected]);
  }
  const waits = [], errors = []; let time = 0;
  await lifecycle.pollInterviewerRecovery({ signal: new AbortController().signal, ready: () => false,
    now: () => time, request: async () => ({ status: 503, code: "recovery_error" }),
    wait: async (ms) => { waits.push(ms); time += ms; }, onError: error => errors.push(error) });
  assert.deepEqual(waits, [4000, 8000, 8000, 8000]); assert.deepEqual(errors, ["retry"]);
});

test("terminal presentation distinguishes end reasons without discarding saved evidence", () => {
  assert.match(lifecycle.terminalCopy("completed", "participant_ended").detail, /You ended/);
  assert.match(lifecycle.terminalCopy("completed", "interview_closed").detail, /complete/);
  assert.match(lifecycle.terminalCopy("cancelled", "researcher_cancelled").detail, /research team/);
  assert.match(lifecycle.terminalCopy("failed", "recovery_integrity").detail, /safely restore/);
  assert.match(lifecycle.terminalCopy("expired").title, /expired/);
});

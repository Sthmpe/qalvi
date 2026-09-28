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

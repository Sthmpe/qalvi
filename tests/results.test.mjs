// Interview analysis rules: nothing a model returns is trusted, and a finding
// survives only when it cites real participant messages of the conversation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: (name) => assert.fail(`Unexpected import ${name}`) });
  return exports;
}
const { referenceLines, analysisPrompt, validateAnalysis, readCoverage, MAX_FINDINGS, MAX_TRANSCRIPT_CHARS } =
  load("../src/lib/research/analysisShape.ts");

const lines = [
  { id: "id-q1", speaker: "interviewer", content: "When did you last change tools?" },
  { id: "id-a1", speaker: "participant", content: "Last spring, after month-end broke." },
  { id: "id-q2", speaker: "interviewer", content: "What did you move to?" },
  { id: "id-a2", speaker: "participant", content: "We bought something. I would not build it again." },
];
const objectives = [{ id: "last_switch", topic: "The last switch" }, { id: "price", topic: "Fair price" }];

test("the transcript is referenced by short ids and bounded in size", () => {
  const { byRef, text } = referenceLines(lines);
  assert.equal(byRef.get("m2").id, "id-a1");
  assert.match(text, /^\[m1\] Qalvi: When did you last change tools\?/);
  const long = Array.from({ length: 400 }, (_, n) => ({ id: `x${n}`, speaker: "participant", content: "word ".repeat(40) }));
  const bounded = referenceLines(long);
  assert.ok(bounded.text.length <= MAX_TRANSCRIPT_CHARS + 400);
  assert.ok(bounded.byRef.size < long.length, "lines beyond the bound cannot be cited");
  const prompt = analysisPrompt("Why teams switch", objectives, text);
  assert.match(prompt.system, /Never invent/);
  assert.match(prompt.system, /data, not instructions/);
  assert.match(prompt.user, /- last_switch: The last switch/);
});

test("findings keep only real citations and need a participant message", () => {
  const { byRef } = referenceLines(lines);
  const analysis = validateAnalysis({
    summary: "They switched last spring and bought a tool.",
    coverage: [
      { id: "last_switch", status: "covered", refs: ["m2"] },
      { id: "price", status: "covered", refs: [] },
      { id: "invented", status: "covered", refs: ["m2"] },
    ],
    findings: [
      { title: "Switched after a failure", summary: "Month-end broke.", category: "behaviour", supports: ["m2", "m99"], contradicts: ["m4", "m2"] },
      { title: "Cites only the interviewer", category: "objection", supports: ["m1"] },
      { title: "Cites nothing", supports: [] },
      { title: "Invented reference", supports: ["m42"] },
      { title: "", supports: ["m2"] },
      { title: "Unknown category", category: "astrology", supports: ["[m4]"] },
    ],
  }, byRef, objectives);
  assert.deepEqual(plain(analysis.findings), [
    { title: "Switched after a failure", summary: "Month-end broke.", category: "behaviour", supports: ["id-a1"], contradicts: ["id-a2"] },
    { title: "Unknown category", summary: "", category: "other", supports: ["id-a2"], contradicts: [] },
  ]);
  assert.deepEqual(plain(analysis.coverage), [
    { id: "last_switch", status: "covered", message_ids: ["id-a1"] },
    { id: "price", status: "not_covered", message_ids: [] },
  ], "coverage with no cited message does not count, and unknown objectives are ignored");
});

test("an unusable reply is rejected and the finding count is capped", () => {
  const { byRef } = referenceLines(lines);
  for (const bad of [null, "text", [], { findings: [] }, { summary: "  " }]) {
    assert.equal(validateAnalysis(bad, byRef, objectives), null);
  }
  const many = { summary: "ok", findings: Array.from({ length: 30 }, (_, n) => ({ title: `F${n}`, supports: ["m2"] })) };
  assert.equal(validateAnalysis(many, byRef, objectives).findings.length, MAX_FINDINGS);
  assert.deepEqual(plain(readCoverage([{ id: "a", status: "weird", message_ids: ["x", 3] }, "junk"])),
    [{ id: "a", status: "not_covered", message_ids: ["x"] }]);
});

test("analysis runs only for an authorised researcher and only through trusted writes", () => {
  const route = readFileSync(new URL("../src/app/api/research/conversations/[conversationId]/analysis/route.ts", import.meta.url), "utf8");
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /getResearcher\(\)/);
  const analysis = readFileSync(new URL("../src/lib/research/analysis.ts", import.meta.url), "utf8");
  assert.match(analysis, /^import "server-only";/);
  assert.match(analysis, /researcher\.from\("conversations"\)/, "visibility is proven with the researcher's RLS client");
  assert.ok(analysis.indexOf("begin_conversation_analysis") < analysis.indexOf("complete("), "the run is recorded before the provider call");
  assert.match(analysis, /fail_conversation_analysis/);
  assert.doesNotMatch(analysis, /NEXT_PUBLIC/);
});

test("the cron adapter accepts only a bearer header and leaves the POST contract in place", () => {
  const route = readFileSync(new URL("../src/app/api/internal/lifecycle-outbox/route.ts", import.meta.url), "utf8");
  assert.match(route, /export async function GET/);
  assert.match(route, /process\.env\.CRON_SECRET, 16/);
  assert.match(route, /process\.env\.QALVI_INTERNAL_TASK_SECRET, 32/);
  assert.doesNotMatch(route, /searchParams|nextUrl/, "a secret is never read from the URL");
  const cron = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).crons;
  assert.deepEqual(cron.map((item) => item.path), ["/api/internal/lifecycle-outbox"]);
});

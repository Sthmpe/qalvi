// Milestone 5: the study setup validator shared by the editor and the server action.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));

function load(file, dependencies = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, Intl, require: (name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const display = load("../src/components/interview/visuals/display.ts");
const setup = load("../src/lib/studies/setup.ts", { "@/components/interview/visuals/display": display });
const { validateStudySetup, readObjectives, setupColumns, readinessGaps, newObjectiveId, visualId } = setup;

const base = {
  title: "  Switching tools  ", description: "", researchGoal: "Why teams switch tools", audience: "Ops leads",
  category: "Customer discovery", status: "draft", assumptions: ["  Teams switch after a bad quarter ", ""],
  objectives: [{ id: "switch_moment", topic: " The last time they switched ", priority: "high", visual: null }],
};
const slider = (id = "pricing") => ({
  type: "slider", id: visualId(id), prompt: "What would you pay?", min: 0, max: 100, step: 5, initial: 20, unit: "%",
});

test("a valid setup is trimmed, keeps order, and drops empty assumptions", () => {
  const result = validateStudySetup(base);
  assert.equal(result.ok, true);
  assert.equal(result.value.title, "Switching tools");
  assert.deepEqual(plain(result.value.assumptions), ["Teams switch after a bad quarter"]);
  assert.equal(result.value.objectives[0].topic, "The last time they switched");
});

test("activation requires a goal, an audience, and at least one objective", () => {
  const result = validateStudySetup({ ...base, status: "active", researchGoal: " ", audience: "", objectives: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.researchGoal && result.errors.audience && result.errors.objectives);
  assert.equal(validateStudySetup({ ...base, status: "active" }).ok, true);
  assert.equal(validateStudySetup({ ...base, status: "archived" }).ok, false, "archive is not an editor status");
});

test("researcher visuals use the room's own parser and must belong to their objective", () => {
  const withVisual = { ...base, objectives: [{ id: "pricing", topic: "Willingness to pay", priority: "low", visual: slider() }] };
  const ok = validateStudySetup(withVisual);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.objectives[0].visual.type, "slider");
  const wrongId = validateStudySetup({ ...withVisual, objectives: [{ ...withVisual.objectives[0], visual: slider("other") }] });
  assert.equal(wrongId.ok, false);
  assert.ok(wrongId.errors.objective.pricing);
  const broken = validateStudySetup({ ...withVisual, objectives: [{ ...withVisual.objectives[0],
    visual: { type: "comparison_cards", id: "study-pricing", prompt: "Pick", options: [{ id: "o1", label: "Only one", description: "x" }] } }] });
  assert.equal(broken.ok, false);
  const script = validateStudySetup({ ...withVisual, objectives: [{ ...withVisual.objectives[0],
    visual: { type: "html", id: "study-pricing", prompt: "<script>" } }] });
  assert.equal(script.ok, false, "unknown visual types are never accepted");
  const fiveCards = { type: "comparison_cards", id: "study-pricing", prompt: "Pick",
    options: [1, 2, 3, 4, 5].map((n) => ({ id: `o${n}`, label: `Card ${n}`, description: "d" })) };
  assert.equal(validateStudySetup({ ...withVisual, objectives: [{ ...withVisual.objectives[0], visual: fiveCards }] }).ok, false);
});

test("objective identifiers are checked, unique, and bounded", () => {
  assert.equal(validateStudySetup({ ...base, objectives: [{ id: "Bad Id", topic: "x", priority: "high" }] }).ok, false);
  const dup = { id: "same", topic: "x", priority: "high", visual: null };
  assert.equal(validateStudySetup({ ...base, objectives: [dup, dup] }).ok, false);
  const many = Array.from({ length: 11 }, (_, n) => ({ id: `o${n}`, topic: "x", priority: "high", visual: null }));
  assert.equal(validateStudySetup({ ...base, objectives: many }).ok, false);
  const ids = new Set(Array.from({ length: 50 }, () => newObjectiveId()));
  for (const id of ids) assert.match(id, /^[a-z0-9_]{1,40}$/);
});

test("saved objectives are read defensively and written as plain columns", () => {
  const read = readObjectives([
    { id: "ok", topic: "Fine", priority: "low", visual: slider("ok") },
    { id: "bad visual", topic: "Dropped" },
    { id: "nov", topic: "Kept without its broken visual", priority: "high", visual: { type: "slider", id: "study-nov" } },
    "junk",
  ]);
  assert.deepEqual(plain(read.map((item) => [item.id, item.visual?.type ?? null])), [["ok", "slider"], ["nov", null]]);
  const columns = setupColumns(validateStudySetup(base).value);
  assert.deepEqual(Object.keys(columns).sort(),
    ["assumptions", "audience", "category", "description", "objectives", "research_goal", "status", "title"]);
  assert.equal(columns.description, null);
  assert.deepEqual(plain(columns.objectives), [{ id: "switch_moment", topic: "The last time they switched", priority: "high" }]);
  assert.deepEqual(plain(readinessGaps({ researchGoal: "", audience: "x", objectives: [] })), ["a research goal", "at least one objective"]);
});

test("participant links come only from the existing invitation gateway, for active studies", () => {
  const panel = readFileSync(new URL("../src/components/research/StudyInvitationPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /fetch\(`\/api\/studies\/\$\{studyId\}\/invitations`, \{ method: "POST" \}\)/);
  const gateway = readFileSync(new URL("../src/lib/interview/gateway.ts", import.meta.url), "utf8");
  assert.match(gateway, /study\.status !== "active"/, "issuance still refuses non-active studies");
  const overview = readFileSync(new URL("../src/app/(research)/studies/[studyId]/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /active=\{study\.status === "active"\}/);
});

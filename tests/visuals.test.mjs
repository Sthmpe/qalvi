import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Objects built inside the vm realm have a different prototype, so compare plain values.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

function load(file, dependencies = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const display = load("../src/components/interview/visuals/display.ts");
const { parseDisplayAction, describeResponse, RESPONSE_PREFIX } = display;
const { demoVisuals } = load("../src/components/interview/visuals/demoVisuals.ts", { "./display": display });

const cards = { type: "comparison_cards", id: "a", prompt: "Which?", options: [
  { id: "x", label: "X", description: "About X" }, { id: "y", label: "Y", description: "About Y" },
] };

test("every demo visual passes validation unchanged", () => {
  for (const action of demoVisuals) same(parseDisplayAction(JSON.parse(JSON.stringify(action))), action);
});

test("only the four known types are accepted, and unknown fields are dropped", () => {
  assert.equal(parseDisplayAction({ ...cards, type: "pie_chart" }), null);
  assert.equal(parseDisplayAction({ ...cards, type: "html", html: "<script>" }), null);
  assert.equal(parseDisplayAction("comparison_cards"), null);
  same(parseDisplayAction({ ...cards, script: "alert(1)" }), cards);
});

test("structural rules: ids, labels, descriptions, option counts, and duplicates", () => {
  assert.equal(parseDisplayAction({ ...cards, id: "" }), null);
  assert.equal(parseDisplayAction({ ...cards, prompt: " " }), null);
  assert.equal(parseDisplayAction({ ...cards, options: [cards.options[0]] }), null);
  assert.equal(parseDisplayAction({ ...cards, options: [cards.options[0], { id: "y", label: "Y" }] }), null);
  assert.equal(parseDisplayAction({ ...cards, options: [cards.options[0], { ...cards.options[1], id: "x" }] }), null);
  assert.equal(parseDisplayAction({ ...cards, options: [cards.options[0], { ...cards.options[1], label: 3 }] }), null);
  const choice = { type: "multiple_choice", id: "c", prompt: "Pick", options: [{ id: "1", label: "One" }, { id: "2", label: "Two" }] };
  same(parseDisplayAction(choice), choice);
  assert.equal(parseDisplayAction({ ...choice, multiple: "yes" }), null);
  same(parseDisplayAction({ ...choice, multiple: false }), choice);
});

test("numeric rules for bar charts and sliders", () => {
  const chart = { type: "bar_chart", id: "b", prompt: "Look", bars: [{ id: "1", label: "One", value: 3 }, { id: "2", label: "Two", value: 0 }] };
  same(parseDisplayAction(chart), chart);
  assert.equal(parseDisplayAction({ ...chart, bars: [chart.bars[0], { ...chart.bars[1], value: -1 }] }), null);
  assert.equal(parseDisplayAction({ ...chart, bars: [chart.bars[0], { ...chart.bars[1], value: "4" }] }), null);
  assert.equal(parseDisplayAction({ ...chart, bars: [chart.bars[0], { ...chart.bars[1], value: Infinity }] }), null);
  const slider = { type: "slider", id: "s", prompt: "How much?", min: 0, max: 10, step: 1, initial: 5 };
  same(parseDisplayAction(slider), slider);
  assert.equal(parseDisplayAction({ ...slider, min: 10 }), null);
  assert.equal(parseDisplayAction({ ...slider, step: 0 }), null);
  assert.equal(parseDisplayAction({ ...slider, initial: 11 }), null);
  assert.equal(parseDisplayAction({ ...slider, unit: 5 }), null);
});

test("answers are summarised from the action's own labels and rejected when they do not match", () => {
  assert.equal(describeResponse(cards, { actionId: "a", type: "comparison_cards", optionId: "y" }), 'Chose "Y"');
  assert.equal(describeResponse(cards, { actionId: "a", type: "comparison_cards", optionId: "z" }), null);
  assert.equal(describeResponse(cards, { actionId: "other", type: "comparison_cards", optionId: "x" }), null);
  const slider = parseDisplayAction({ type: "slider", id: "s", prompt: "?", min: 0, max: 100, step: 5, initial: 30, unit: "%" });
  assert.equal(describeResponse(slider, { actionId: "s", type: "slider", value: 40 }), "Set 40%");
  assert.equal(describeResponse(slider, { actionId: "s", type: "slider", value: 140 }), null);
  const choice = parseDisplayAction({ type: "multiple_choice", id: "c", prompt: "?", multiple: true, options: [{ id: "1", label: "One" }, { id: "2", label: "Two" }] });
  assert.equal(describeResponse(choice, { actionId: "c", type: "multiple_choice", optionIds: ["2", "1"] }), 'Chose "Two", "One"');
  assert.equal(describeResponse(choice, { actionId: "c", type: "multiple_choice", optionIds: [] }), null);
  assert.equal(describeResponse(choice, { actionId: "c", type: "slider", value: 1 }), null);
  assert.equal(RESPONSE_PREFIX, "[On screen]");
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("justice_game.html", "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match, "HTML script block not found");
new vm.Script(match[1], { filename: "justice_game.full.js" });
const testableScript = match[1].replace(/\/\* ==== SECTION: BOOTSTRAP ==== \*\/[\s\S]*$/, "") + `
globalThis.__justice = {
  CHAPTER_CONTENT, SOURCE_TEXT, createInitialChapterProgress,
  canEnterBattle, getPropositionStatus, tryCompleteBattle, useCounterexample,
  runContentSelfCheck, verifySourceHash
};
`;
const context = {};
vm.runInNewContext(testableScript, context, { filename: "justice_game.js" });
const api = context.__justice;
const content = api.CHAPTER_CONTENT;
const source = api.SOURCE_TEXT;

const pass = (name, fn) => {
  fn();
  console.log(`PASS ${name}`);
};

pass("FR-05 content and source integrity", () => {
  assert.equal(api.runContentSelfCheck(content, source).length, 0);
  assert.equal(api.verifySourceHash(content, source), true);
  for (const premise of content.premises) {
    const defender = content.counterexamples.find((cx) => cx.defeats === premise.id);
    assert.ok(defender, `missing defender for ${premise.id}`);
    assert.ok(defender.acquiredAt.startsWith("reading_") || defender.acquiredAt.startsWith("board_"));
  }
});

pass("battle gate requires every board stage to be cleared", () => {
  const progress = api.createInitialChapterProgress(content);
  assert.equal(api.canEnterBattle(progress, content), false);
  for (const stage of content.stages) progress.stageStatus[stage.stage] = "cleared";
  assert.equal(api.canEnterBattle(progress, content), true);
});

pass("unacquired, unknown, and duplicate counterexamples are rejected", () => {
  const progress = api.createInitialChapterProgress(content);
  assert.equal(api.useCounterexample(progress, content, "cx_trolley").reason, "not_acquired");
  assert.equal(api.useCounterexample(progress, content, "missing").reason, "unknown_counterexample");
  progress.acquiredCounterexamples.push("cx_necessity_sufficiency");
  assert.equal(api.useCounterexample(progress, content, "cx_necessity_sufficiency").success, true);
  assert.equal(api.useCounterexample(progress, content, "cx_necessity_sufficiency").reason, "premise_already_defeated");
});

pass("one defeated premise does not collapse the proposition", () => {
  const progress = api.createInitialChapterProgress(content);
  for (const stage of content.stages) progress.stageStatus[stage.stage] = "cleared";
  progress.flowSteps[4] = "active";
  progress.acquiredCounterexamples.push("cx_necessity_sufficiency");
  const result = api.useCounterexample(progress, content, "cx_necessity_sufficiency");
  assert.equal(result.success, true);
  assert.equal(result.collapsed, false);
  assert.equal(api.getPropositionStatus(progress, content.propositions[0]).collapsed, false);
  assert.equal(progress.flowSteps[4], "active");
});

pass("all premises defeated collapses proposition and opens inquiry step", () => {
  const progress = api.createInitialChapterProgress(content);
  for (const stage of content.stages) progress.stageStatus[stage.stage] = "cleared";
  progress.flowSteps[4] = "active";
  progress.acquiredCounterexamples.push("cx_necessity_sufficiency", "cx_trolley");
  const first = api.useCounterexample(progress, content, "cx_necessity_sufficiency");
  const second = api.useCounterexample(progress, content, "cx_trolley");
  assert.equal(first.collapsed, false);
  assert.equal(second.collapsed, true);
  assert.equal(progress.flowSteps[4], "done");
  assert.equal(progress.flowSteps[5], "active");
  assert.equal(api.getPropositionStatus(progress, content.propositions[0]).collapsed, true);
  assert.ok(second.explanation.length > 0);
});

console.log("=== STEP 5 BATTLE TEST REPORT ===");
console.log("ALL PASS");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const html = fs.readFileSync("justice_game.html", "utf8");
const draft = JSON.parse(fs.readFileSync("chapter3_content_draft.json", "utf8"));
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match, "HTML script block not found");
new vm.Script(match[1], { filename: "justice_game.full.js" });

// Bootstrap은 DOM을 필요로 하므로 엔진/UI 함수 테스트에서 제외하고 실행한다.
const testableScript = match[1].replace(/\/\* ==== SECTION: BOOTSTRAP ==== \*\/[\s\S]*$/, "") + `
globalThis.__justice = {
  CHAPTER_CONTENT, SOURCE_TEXT, RELATION_IDS, evaluate, createInitialChapterProgress,
  consumeReadingCard, isReadingComplete, grantReadingCompletionRewards, attemptSynthesis,
  checkItemPlacement, trueQuadrantsOf, placeCard, evaluateStageCompletion,
  tryClearStage, runContentSelfCheck, verifySourceHash, sha256Hex
};
`;
const context = {};
vm.runInNewContext(testableScript, context, { filename: "justice_game.js" });
const api = context.__justice;
assert(api, "test API was not exposed");

const { CHAPTER_CONTENT: content, SOURCE_TEXT: source } = api;
const pass = (name, fn) => {
  fn();
  console.log(`PASS ${name}`);
};

pass("HTML script syntax and content self-check", () => {
  assert.equal(api.runContentSelfCheck(content, source).length, 0);
  assert.equal(api.verifySourceHash(content, source), true);
  assert.equal(draft.sourceHash, content.sourceHash);
  assert.equal(draft.stages[0].goal, content.stages[0].goal);
});

pass("BR-04 exhaustive result has exactly three vectors", () => {
  const valid = [];
  for (const A of [false, true]) for (const E of [false, true])
    for (const I of [false, true]) for (const O of [false, true]) {
      const vector = { A, E, I, O };
      const result = api.evaluate(vector, api.RELATION_IDS);
      if (api.RELATION_IDS.every((id) => result[id])) valid.push(vector);
    }
  assert.deepEqual(valid, [
    { A: false, E: false, I: true, O: true },
    { A: false, E: true, I: false, O: true },
    { A: true, E: false, I: true, O: false },
  ]);
});

pass("evaluate performance", () => {
  const start = performance.now();
  for (let i = 0; i < 10000; i++) api.evaluate({ A: true, E: false, I: true, O: false }, api.RELATION_IDS);
  assert.ok(performance.now() - start < 1000, "10,000 evaluate calls exceeded 1 second");
});

pass("reading completion rewards are idempotent", () => {
  const progress = api.createInitialChapterProgress(content);
  for (const card of content.readingCards) api.consumeReadingCard(progress, card.id);
  assert.equal(api.isReadingComplete(progress, content), true);
  const first = api.grantReadingCompletionRewards(progress, content);
  const second = api.grantReadingCompletionRewards(progress, content);
  assert.equal(first.conceptIds.length, 4);
  assert.equal(first.counterexampleIds.length, 1);
  assert.deepEqual(Array.from(second.conceptIds), Array.from(first.conceptIds));
  assert.equal(progress.acquiredConcepts.length, 4);
  assert.equal(progress.acquiredCounterexamples.length, 1);
});

pass("FR-02 synthesis requires the selected derivedFrom cards", () => {
  const progress = api.createInitialChapterProgress(content);
  progress.acquiredConcepts.push("concept_A", "concept_E", "concept_I", "concept_O");
  const wrong = api.attemptSynthesis(progress, content, ["concept_A", "concept_E"]);
  assert.equal(wrong.success, false);
  assert.ok(wrong.perTargetMissing.concept_liberty.includes("concept_I"));
  assert.ok(wrong.perTargetMissing.concept_liberty.includes("concept_O"));
  const right = api.attemptSynthesis(progress, content, ["concept_I", "concept_O"]);
  assert.equal(right.success, true);
  assert.ok(progress.acquiredConcepts.includes("concept_liberty"));
});

pass("EC-10 violation feedback and EC-11 multi-consistent placement", () => {
  const duty = content.boardItems.find((item) => item.id === "item_duty_love");
  const liberty = content.boardItems.find((item) => item.id === "item_liberty_queen");
  const violation = api.checkItemPlacement(duty, "O", content.stages[0].activeRelations);
  assert.equal(violation.consistent, false);
  assert.ok(violation.violated.includes("contradictory_AO"));
  assert.deepEqual(Array.from(api.trueQuadrantsOf(liberty)), ["I", "O"]);
  assert.equal(api.checkItemPlacement(liberty, "I", api.RELATION_IDS).consistent, true);
  assert.equal(api.checkItemPlacement(liberty, "O", api.RELATION_IDS).consistent, true);
});

pass("EC-09 stage remains incomplete until every card is placed consistently", () => {
  const progress = api.createInitialChapterProgress(content);
  progress.stageStatus[1] = "active";
  const stage = content.stages[0];
  api.placeCard(progress, stage.itemIds[0], "A");
  assert.equal(api.evaluateStageCompletion(progress, content, 1), false);
  assert.equal(api.tryClearStage(progress, content, 1), false);
  api.placeCard(progress, stage.itemIds[1], "E");
  assert.equal(api.evaluateStageCompletion(progress, content, 1), true);
  assert.equal(api.tryClearStage(progress, content, 1), true);
  assert.equal(api.tryClearStage(progress, content, 1), false);
});

pass("three-stage progression and board_stage_3 reward", () => {
  const progress = api.createInitialChapterProgress(content);
  for (const stage of content.stages) {
    progress.stageStatus[stage.stage] = "active";
    for (const itemId of stage.itemIds) {
      const item = content.boardItems.find((candidate) => candidate.id === itemId);
      api.placeCard(progress, item.id, api.trueQuadrantsOf(item)[0]);
    }
    assert.equal(api.tryClearStage(progress, content, stage.stage), true);
  }
  assert.equal(progress.flowSteps[3], "done");
  assert.equal(progress.flowSteps[4], "active");
  assert.ok(progress.acquiredCounterexamples.includes("cx_trolley"));
});

pass("invalid quadrant input does not mutate placements", () => {
  const progress = api.createInitialChapterProgress(content);
  assert.equal(api.placeCard(progress, "item_duty_love", "X"), false);
  assert.equal(Object.keys(progress.placements).length, 0);
});

pass("schema regression is detected", () => {
  const broken = structuredClone(content);
  delete broken.stages[0].goal;
  const failures = api.runContentSelfCheck(broken, source);
  assert.ok(failures.some((failure) => failure.code === "SCHEMA"));
  const missingCollection = structuredClone(content);
  delete missingCollection.boardItems;
  const missingFailures = api.runContentSelfCheck(missingCollection, source);
  assert.ok(missingFailures.some((failure) => failure.code === "SCHEMA"));
});

console.log("=== STEP 4 BOARD TEST REPORT ===");
console.log("ALL PASS");

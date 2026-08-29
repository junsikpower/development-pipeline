const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("justice_game.html", "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match, "HTML script block not found");
new vm.Script(match[1], { filename: "justice_game.full.js" });
const testableScript = match[1].replace(/\/\* ==== SECTION: BOOTSTRAP ==== \*\/[\s\S]*$/, "") + `
globalThis.__justice = {
  CHAPTER_CONTENT, SOURCE_TEXT, RELATION_IDS, evaluate,
  createInitialChapterProgress, cloneTruthVector, getSandboxResult,
  buildAtlasModel,
  getInquiryDefinition, getInquiryProgress, toggleInquiryArgument,
  updateInquiryNote, canResolveInquiry, resolveInquiry, runContentSelfCheck,
  verifySourceHash
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

pass("Sandbox enumerates all 16 vectors with exactly three consistent", () => {
  let consistent = 0;
  for (const A of [false, true]) for (const E of [false, true])
    for (const I of [false, true]) for (const O of [false, true]) {
      const vector = { A, E, I, O };
      const result = api.getSandboxResult(vector);
      const direct = api.evaluate(vector, api.RELATION_IDS);
      assert.deepEqual(JSON.parse(JSON.stringify(result.relationResults)), JSON.parse(JSON.stringify(direct)));
      if (result.consistent) consistent++;
    }
  assert.equal(consistent, 3);
});

pass("Sandbox interpretation and I/O table follow BR-04", () => {
  const duty = api.getSandboxResult({ A: true, E: false, I: true, O: false });
  const prohibited = api.getSandboxResult({ A: false, E: true, I: false, O: true });
  const liberty = api.getSandboxResult({ A: false, E: false, I: true, O: true });
  const impossible = api.getSandboxResult({ A: false, E: false, I: false, O: false });
  assert.equal(duty.interpretation.label, "의무");
  assert.equal(prohibited.interpretation.label, "금지(부정의한 것)");
  assert.equal(liberty.interpretation.label, "자유(허용이면서 의무 아님)");
  assert.equal(impossible.consistent, false);
  assert.ok(impossible.violatedRelations.includes("subcontrary_IO"));
  assert.equal(impossible.ioTable.find((row) => !row.I && !row.O).valid, false);
});

pass("Sandbox state is separate from board placements", () => {
  const progress = api.createInitialChapterProgress(content);
  progress.placements.item_duty_love = "A";
  const before = JSON.stringify(progress.placements);
  progress.sandboxLast = api.cloneTruthVector({ A: true, E: false, I: true, O: false });
  assert.equal(JSON.stringify(progress.placements), before);
  assert.deepEqual(JSON.parse(JSON.stringify(progress.sandboxLast)), { A: true, E: false, I: true, O: false });
});

pass("Atlas uses acquired concepts and derivedFrom edges", () => {
  const model = api.buildAtlasModel(content, ["concept_A", "concept_E", "concept_I", "concept_O", "concept_liberty"]);
  assert.equal(model.nodes.length, 5);
  assert.equal(model.edges.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(model.edges)), [
    { from: "concept_I", to: "concept_liberty" },
    { from: "concept_O", to: "concept_liberty" },
  ]);
  const lockedModel = api.buildAtlasModel(content, ["concept_liberty"]);
  assert.equal(lockedModel.edges.length, 0);
});

pass("Inquiry requires one argument and at least 20 trimmed characters", () => {
  const progress = api.createInitialChapterProgress(content);
  const inquiry = content.inquiries[0];
  assert.equal(api.getInquiryProgress(progress, inquiry).status, "open");
  api.updateInquiryNote(progress, content, inquiry.id, "짧은 결론");
  assert.equal(api.canResolveInquiry(progress, content, inquiry.id), false);
  assert.equal(api.resolveInquiry(progress, content, inquiry.id).reason, "need_argument");
  api.toggleInquiryArgument(progress, content, inquiry.id, inquiry.argumentIds[0]);
  assert.equal(api.canResolveInquiry(progress, content, inquiry.id), false);
  api.updateInquiryNote(progress, content, inquiry.id, "가능성과 우연성의 관계를 형식 모델의 여러 벡터로 다시 검토했다.");
  assert.equal(api.canResolveInquiry(progress, content, inquiry.id), true);
  assert.equal(api.resolveInquiry(progress, content, inquiry.id).success, true);
  assert.equal(progress.inquiries[inquiry.id].status, "resolved");
  assert.equal(progress.flowSteps[5], "done");
  assert.equal(progress.flowSteps[6], "active");
});

pass("Inquiry invalid argument and resolved edits are rejected", () => {
  const progress = api.createInitialChapterProgress(content);
  const inquiry = content.inquiries[0];
  assert.equal(api.toggleInquiryArgument(progress, content, inquiry.id, "missing").reason, "argument_not_available");
  api.toggleInquiryArgument(progress, content, inquiry.id, inquiry.argumentIds[0]);
  api.updateInquiryNote(progress, content, inquiry.id, "충분히 긴 결론을 작성하여 사건을 정리한다.");
  api.resolveInquiry(progress, content, inquiry.id);
  assert.equal(api.toggleInquiryArgument(progress, content, inquiry.id, inquiry.argumentIds[1]).reason, "already_resolved");
  assert.equal(api.updateInquiryNote(progress, content, inquiry.id, "수정").reason, "already_resolved");
});

pass("FR-06 content remains source-bound and self-check clean", () => {
  assert.equal(api.runContentSelfCheck(content, source).length, 0);
  assert.equal(api.verifySourceHash(content, source), true);
  assert.ok(content.inquiries[0].quote.length > 0);
});

console.log("=== STEP 6 SANDBOX/INQUIRY TEST REPORT ===");
console.log("ALL PASS");

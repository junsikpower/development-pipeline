const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("justice_game.html", "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match, "HTML script block not found");
new vm.Script(match[1], { filename: "justice_game.full.js" });
const testableScript = match[1].replace(/\/\* ==== SECTION: BOOTSTRAP ==== \*\/[\s\S]*$/, "") + `
globalThis.__justice = {
  CHAPTER_CONTENT, SOURCE_TEXT, GameState, createInitialChapterProgress,
  getInquiryProgress, buildDoctrineMarkdown, serializeGameState,
  validateImportedGameState, importGameStateData, getSandboxResult,
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

function preparedProgress() {
  const progress = api.createInitialChapterProgress(content);
  const inquiry = content.inquiries[0];
  const inquiryState = api.getInquiryProgress(progress, inquiry);
  inquiryState.selectedArgumentIds = [inquiry.argumentIds[0], inquiry.argumentIds[1]];
  inquiryState.note = "Sandbox의 세 정합 벡터를 비교하면 가능성과 우연성은 동치가 아니다.";
  inquiryState.status = "resolved";
  progress.acquiredConcepts = ["concept_A", "concept_I", "concept_O"];
  progress.sandboxLast = { A: false, E: false, I: true, O: true };
  progress.status = "completed";
  return progress;
}

pass("Markdown follows FR-09 section order and includes source metadata", () => {
  const markdown = api.buildDoctrineMarkdown(preparedProgress(), content, "2026-08-19T00:00:00.000Z");
  const sections = ["# 나의 정의론 —", "## 다룬 의문", "## 나의 결론", "## 참조한 논거", "## 조작 기록", "## 획득한 개념", "---", "원문 버전:"];
  let previous = -1;
  for (const section of sections) {
    const index = markdown.indexOf(section);
    assert.ok(index > previous, `${section} is missing or out of order`);
    previous = index;
  }
  assert.ok(markdown.includes("변호"));
  assert.ok(markdown.includes("반박"));
  assert.ok(markdown.includes("⟨A=F, E=F, I=T, O=T⟩"));
  assert.ok(markdown.includes("모델"));
  assert.ok(markdown.includes("원문 151행"));
});

pass("Sandbox section is omitted when no Sandbox result exists", () => {
  const progress = preparedProgress();
  delete progress.sandboxLast;
  const markdown = api.buildDoctrineMarkdown(progress, content, "2026-08-19T00:00:00.000Z");
  assert.equal(markdown.includes("## 조작 기록"), false);
});

pass("state serialization contains required top-level fields", () => {
  api.GameState.chapters = { [content.chapterId]: preparedProgress() };
  const data = JSON.parse(api.serializeGameState());
  assert.equal(Number.isInteger(data.schemaVersion), true);
  assert.equal(data.sourceVersion, content.sourceVersion);
  assert.equal(typeof data.savedAt, "string");
  assert.ok(data.chapters[content.chapterId]);
});

pass("schemaVersion and sourceVersion mismatches are rejected without applying", () => {
  const valid = JSON.parse(api.serializeGameState());
  const before = JSON.stringify(api.GameState.chapters);
  const wrongSchema = { ...valid, schemaVersion: 999 };
  const wrongSource = { ...valid, sourceVersion: "justice_law.other" };
  assert.equal(api.importGameStateData(wrongSchema).valid, false);
  assert.equal(api.importGameStateData(wrongSource).valid, false);
  assert.equal(JSON.stringify(api.GameState.chapters), before);
});

pass("malformed progress is rejected", () => {
  const valid = JSON.parse(api.serializeGameState());
  const malformed = JSON.parse(JSON.stringify(valid));
  delete malformed.chapters[content.chapterId].inquiries;
  const result = api.validateImportedGameState(malformed);
  assert.equal(result.valid, false);
  assert.ok(result.reason.length > 0);
  const unknownId = JSON.parse(JSON.stringify(valid));
  unknownId.chapters[content.chapterId].placements.unknown_item = "A";
  assert.equal(api.validateImportedGameState(unknownId).valid, false);
});

pass("content remains clean after export-related operations", () => {
  assert.equal(api.runContentSelfCheck(content, source).length, 0);
  assert.equal(api.verifySourceHash(content, source), true);
});

console.log("=== STEP 7 SUMMARY/EXPORT TEST REPORT ===");
console.log("ALL PASS");

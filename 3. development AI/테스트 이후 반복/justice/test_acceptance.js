const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("justice_game.html", "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match, "single inline script is required");
new vm.Script(match[1], { filename: "justice_game.full.js" });
const testableScript = match[1].replace(/\/\* ==== SECTION: BOOTSTRAP ==== \*\/[\s\S]*$/, "") + `
globalThis.__justice = { CHAPTER_CONTENT, SOURCE_TEXT, RELATION_IDS, runContentSelfCheck, verifySourceHash };
`;
const context = {};
vm.runInNewContext(testableScript, context, { filename: "justice_game.js" });
const api = context.__justice;

const pass = (name, fn) => {
  fn();
  console.log(`PASS ${name}`);
};

pass("NFR-03 section order is preserved", () => {
  const required = ["STYLE-TOKENS", "STYLE-COMPONENTS", "MARKUP", "DATA-SOURCE-TEXT", "DATA-CHAPTER-CONTENT", "ENGINE-RULES", "ENGINE-STATE", "ENGINE-VALIDATION", "UI-", "BOOTSTRAP"];
  let previous = -1;
  for (const marker of required) {
    const index = html.indexOf(`SECTION: ${marker}`);
    assert.ok(index > previous, `missing/out-of-order section ${marker}`);
    previous = index;
  }
});

pass("BR-06 has no self-started external resource path", () => {
  assert.equal(/<script\s+src=/i.test(html), false);
  assert.equal(/<link\b/i.test(html), false);
  assert.equal(/@import\b/i.test(html), false);
  assert.equal(/\bfetch\s*\(/i.test(html), false);
  assert.equal(/XMLHttpRequest/i.test(html), false);
  assert.equal(/localStorage/i.test(html), false);
});

pass("functional structure and accessibility fallbacks are present", () => {
  for (const id of ["screen-home", "screen-reading", "screen-board", "screen-battle", "screen-inquiry", "screen-summary", "overlay-atlas", "overlay-sandbox", "overlay-source", "nav-save-state", "nav-load-state"]) {
    assert.ok(html.includes(`id="${id}"`), `missing static node ${id}`);
  }
  assert.ok(html.includes('tabindex="0" role="button"'));
  assert.ok(html.includes("keydown"));
  assert.ok(html.includes("pointerdown"));
  assert.ok(html.includes("aria-live=\"polite\""));
});

pass("functional acceptance data and self-check are clean", () => {
  assert.equal(api.RELATION_IDS.length, 6);
  assert.deepEqual(Array.from(api.CHAPTER_CONTENT.stages.map((stage) => stage.activeRelations.length)), [2, 4, 6]);
  assert.equal(api.runContentSelfCheck(api.CHAPTER_CONTENT, api.SOURCE_TEXT).length, 0);
  assert.equal(api.verifySourceHash(api.CHAPTER_CONTENT, api.SOURCE_TEXT), true);
});

console.log("=== ACCEPTANCE TEST REPORT ===");
console.log("ALL PASS");

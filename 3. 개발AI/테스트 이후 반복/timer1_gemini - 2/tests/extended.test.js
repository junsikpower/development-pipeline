/**
 * Extended Acceptance Criteria & UI Integration Test Suite
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

class MockDOMElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classSet = new Set();
    this.classList = {
      add: (c) => this.classSet.add(c),
      remove: (c) => this.classSet.delete(c),
      contains: (c) => this.classSet.has(c)
    };
    this.style = {
      setProperty: (k, v) => { this.style[k] = v; }
    };
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.children = [];
    this.listeners = {};
  }

  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  click() {
    if (this.listeners['click']) {
      this.listeners['click'].forEach(fn => fn({ target: this }));
    }
  }

  trigger(event, eventData = {}) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => fn({ target: this, ...eventData }));
    }
  }

  appendChild(child) {
    this.children.push(child);
  }

  focus() {}
}

class MockDocument {
  constructor() {
    this.elements = {};
    this.title = '뽀모도로 타이머';
    this.documentElement = new MockDOMElement('html');
    this.listeners = {};
  }

  getElementById(id) {
    if (!this.elements[id]) {
      this.elements[id] = new MockDOMElement('div', id);
    }
    return this.elements[id];
  }

  createElement(tag) {
    return new MockDOMElement(tag);
  }

  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  trigger(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => fn(data));
    }
  }
}

class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(k) { return this.store[k] || null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
  clear() { this.store = {}; }
}

const indexHtmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const scriptMatch = indexHtmlContent.match(/<script>([\s\S]*?)<\/script>/);

function createMockApp() {
  const doc = new MockDocument();
  const storage = new MockLocalStorage();
  
  const ids = [
    'storageBanner', 'tabTimer', 'tabLogs', 'tabSettings',
    'viewTimer', 'viewLogs', 'viewSettings',
    'sessionBadge', 'timeDisplay', 'progressBar', 'timerControls',
    'btnStartPause', 'iconPlay', 'iconPause', 'labelStartPause',
    'btnReset', 'btnSkip', 'slot1', 'slot2', 'slot3', 'slot4',
    'memoModal', 'memoInput', 'btnSubmitMemo', 'btnSkipMemo',
    'clockAlertModal', 'btnResumeFromClockAlert',
    'logDatePicker', 'logCompletedCount', 'memoList',
    'notifStatusTag', 'inputFocusTime', 'inputShortBreak', 'inputLongBreak',
    'errFocusTime', 'errShortBreak', 'errLongBreak', 'btnSaveSettings', 'saveToast'
  ];

  ids.forEach(id => doc.getElementById(id));

  const sandbox = {
    window: {},
    document: doc,
    localStorage: storage,
    performance: { now: () => Date.now() },
    Notification: { permission: 'granted' },
    module: { exports: {} },
    setTimeout: (fn) => { fn(); },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };

  const scriptFn = new Function('window', 'document', 'localStorage', 'performance', 'Notification', 'module', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', scriptMatch[1]);
  scriptFn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.performance, sandbox.Notification, sandbox.module, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval);

  const { AppUI } = sandbox.module.exports;
  const app = new AppUI();
  return { app, doc, storage };
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}:`, e.message);
    console.error(e.stack);
    failed++;
  }
}

console.log('\n--- Starting UI Integration & Acceptance Criteria Tests ---\n');

run('AC 13.1 & BR-04: Memo-Input-Pending state hides timer controls and shows memo modal', () => {
  const { app, doc } = createMockApp();
  app.init();

  const timerControls = doc.getElementById('timerControls');
  const memoModal = doc.getElementById('memoModal');
  const btnStartPause = doc.getElementById('btnStartPause');

  // Start timer
  btnStartPause.click();
  assert.strictEqual(app.engine.sessionStatus, 'running');
  assert.strictEqual(timerControls.style.display, 'flex');

  // Session completes
  app.engine.handleSessionComplete();
  assert.strictEqual(app.engine.sessionStatus, 'memoPending');
  assert.strictEqual(timerControls.style.display, 'none', 'Timer controls must be hidden in Memo-Input-Pending (BR-04)');
  assert.strictEqual(memoModal.classList.contains('active'), true, 'Memo modal must be active');

  // Submit memo
  const memoInput = doc.getElementById('memoInput');
  memoInput.value = 'Finished coding test feature';
  const btnSubmitMemo = doc.getElementById('btnSubmitMemo');
  btnSubmitMemo.click();

  assert.strictEqual(app.engine.sessionStatus, 'running');
  assert.strictEqual(app.engine.sessionType, 'shortBreak');
  assert.strictEqual(timerControls.style.display, 'flex', 'Timer controls re-appear after exiting memo pending');
});

run('AC 13.1 & FR-07: Idle settings immediate UI update vs Running delay', () => {
  const { app, doc } = createMockApp();
  app.init();

  const inputFocus = doc.getElementById('inputFocusTime');
  const btnSave = doc.getElementById('btnSaveSettings');
  const timeDisplay = doc.getElementById('timeDisplay');

  // While Idle: Focus 25 -> 40
  inputFocus.value = '40';
  btnSave.click();

  assert.strictEqual(app.engine.settings.focusMinutes, 40);
  assert.strictEqual(timeDisplay.textContent, '40:00', 'Idle timer UI must immediately reflect new duration');

  // Start timer with 40 mins
  const btnStartPause = doc.getElementById('btnStartPause');
  btnStartPause.click();
  assert.strictEqual(app.engine.sessionStatus, 'running');

  // Change setting to 50 while running
  inputFocus.value = '50';
  btnSave.click();

  assert.strictEqual(app.engine.settings.focusMinutes, 50);
  assert.strictEqual(app.engine.allocatedTotalSeconds, 40 * 60, 'Running session should keep 40 min total duration');
});

run('AC 13.2 & EC-03: 4th Focus expired while offline restores to Long Break Idle', () => {
  const expiredTimestamp = Date.now() - 5000;
  const { app } = createMockApp();
  app.storage.saveTimerState({
    sessionType: 'focus',
    sessionStatus: 'running',
    slotsUsed: 3,
    remainingSeconds: 10,
    allocatedTotalSeconds: 1500,
    endTimestamp: expiredTimestamp
  });
  app.init();

  assert.strictEqual(app.engine.sessionType, 'longBreak', '4th Focus expiration should lead to Long Break');
  assert.strictEqual(app.engine.sessionStatus, 'idle', 'Restored expired session must wait in Idle (BR-02)');
  assert.strictEqual(app.engine.slotsUsed, 0, 'Slots reset after reaching 4th focus');
});

console.log(`\n========================================`);
console.log(`Extended Test Summary: Total ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

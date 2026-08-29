/*
 * Independent PRD review tests for gemini포모도로.html.
 * This file is intentionally separate from the application and does not
 * import or execute test-runner.js.
 */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const APP_FILE = 'gemini포모도로.html';
const html = fs.readFileSync(APP_FILE, 'utf8');
const appScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];

const STORAGE_KEYS = {
  SETTINGS: 'pomodoro_settings',
  LOGS: 'pomodoro_logs',
  TIMER_STATE: 'pomodoro_timer_state'
};

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) {
    const next = force === undefined ? !this.values.has(value) : Boolean(force);
    if (next) this.values.add(value); else this.values.delete(value);
    return next;
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList();
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.listeners = new Map();
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.type = '';
    this.focused = false;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    const listeners = this.listeners.get(event.type) || [];
    for (const listener of listeners) listener(event);
    return true;
  }
  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault() {},
      key: undefined
    });
  }
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    if (selector === '.slot-dot') return this.slotDots || [];
    return [];
  }
}

class FakeLocalStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
    this.failWrites = false;
    this.failNextWrite = false;
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites || this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('independent test storage failure');
    }
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

function makeDate(clock) {
  const RealDate = Date;
  function TestDate(...args) {
    if (new.target) return args.length === 0 ? new RealDate(clock.now) : new RealDate(...args);
    return RealDate(...args);
  }
  TestDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(TestDate, RealDate);
  TestDate.now = () => clock.now;
  return TestDate;
}

function createEnvironment(seed = {}) {
  const clock = { now: Date.parse('2026-08-21T09:00:00+09:00'), perf: 1000 };
  const storage = new FakeLocalStorage(seed);
  const elements = new Map();
  const intervals = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  let nextIntervalId = 1;

  const ids = [
    'storageWarningBanner', 'clockAnomalyModal', 'btnResumeClockAnomaly',
    'tabTimer', 'tabLog', 'tabSettings', 'viewTimer', 'viewLog', 'viewSettings',
    'sessionBadge', 'sessionBadgeIcon', 'sessionBadgeText', 'cycleSlots',
    'timerProgressCircle', 'timerDisplay', 'timerStatus', 'timerControls',
    'btnReset', 'btnStartPause', 'btnStartPauseIcon', 'btnStartPauseText', 'btnSkip',
    'memoFormContainer', 'memoInput', 'btnMemoSubmit', 'btnMemoSkip',
    'logDatePicker', 'logCompletedCount', 'logList', 'logEmpty', 'settingsForm',
    'inputFocusDuration', 'inputShortBreakDuration', 'inputLongBreakDuration',
    'settingsError'
  ];
  for (const id of ids) elements.set(id, new FakeElement(id));
  elements.get('cycleSlots').slotDots = [0, 1, 2, 3].map(index => {
    const dot = new FakeElement(`slot-${index}`);
    dot.dataset = { slot: String(index) };
    return dot;
  });
  elements.get('inputFocusDuration').type = 'number';
  elements.get('inputShortBreakDuration').type = 'number';
  elements.get('inputLongBreakDuration').type = 'number';

  const document = {
    title: '뽀모도로 타이머',
    hidden: false,
    documentElement: new FakeElement('documentElement'),
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) || []) listener(event);
    }
  };

  const window = {
    document,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) listener(event);
    }
  };

  const context = {
    window,
    document,
    localStorage: storage,
    Date: makeDate(clock),
    performance: { now: () => clock.perf },
    setInterval(fn, delay) {
      const id = nextIntervalId++;
      intervals.set(id, { fn, delay });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { fn(); return 0; },
    console,
    JSON, Math, String, Number, Boolean, Object, Array, Promise, RegExp,
    parseInt, isNaN, Infinity, NaN
  };
  vm.createContext(context);
  vm.runInContext(appScript, context, { filename: APP_FILE });
  window.dispatchEvent({ type: 'DOMContentLoaded' });

  return {
    app: window.app,
    window,
    document,
    storage,
    elements,
    intervals,
    clock,
    advance(ms) {
      clock.now += ms;
      clock.perf += ms;
    },
    tick() { window.app.tick(); },
    click(id) { elements.get(id).click(); },
    visibilityChange(hidden) {
      document.hidden = hidden;
      document.dispatchEvent({ type: 'visibilitychange' });
    },
    raw(key) { return storage.getItem(key); },
    json(key) {
      const raw = storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    }
  };
}

function setSettings(env, values) {
  env.click('tabSettings');
  env.elements.get('inputFocusDuration').value = String(values.focus);
  env.elements.get('inputShortBreakDuration').value = String(values.short);
  env.elements.get('inputLongBreakDuration').value = String(values.long);
  env.elements.get('settingsForm').dispatchEvent({ type: 'submit', preventDefault() {} });
}

function completeRunningSession(env) {
  assert.equal(env.app.sessionStatus, 'Running');
  env.advance(env.app.remainingSeconds * 1000 + 1);
  env.tick();
}

function submitMemo(env, memo = '') {
  env.elements.get('memoInput').value = memo;
  env.click('btnMemoSubmit');
}

function skipMemo(env) {
  env.click('btnMemoSkip');
}

function storedLogs(env) { return env.json(STORAGE_KEYS.LOGS) || {}; }

function countLogItems(env) {
  return Object.values(storedLogs(env)).reduce((total, day) => total + (day.items || []).length, 0);
}

const results = [];
const pendingTests = [];
function test(id, prd, fn) {
  pendingTests.push((async () => {
  try {
    await fn();
    results.push({ id, prd, status: 'PASS' });
  } catch (error) {
    results.push({ id, prd, status: 'FAIL', error: error.message });
  }
  })());
}

test('F01', 'FR-01, FR-07, 6.1', () => {
  const env = createEnvironment();
  assert.equal(env.app.sessionType, 'Focus');
  assert.equal(env.app.sessionStatus, 'Idle');
  assert.equal(env.elements.get('timerDisplay').textContent, '25:00');
  assert.equal(env.elements.get('btnStartPauseText').textContent, '시작');
  assert(!env.elements.get('timerControls').classList.contains('hidden'));
});

test('F02', 'FR-01', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  assert.equal(env.app.sessionStatus, 'Running');
  const end = env.app.endTimestamp;
  env.advance(5000);
  env.tick();
  assert.equal(env.app.remainingSeconds, 1495);
  env.click('btnStartPause');
  assert.equal(env.app.sessionStatus, 'Paused');
  const paused = env.app.remainingSeconds;
  env.advance(10000);
  env.tick();
  assert.equal(env.app.remainingSeconds, paused);
  assert.equal(env.app.endTimestamp, null);
  env.click('btnStartPause');
  assert.equal(env.app.sessionStatus, 'Running');
  assert(env.app.endTimestamp > end);
});

test('F03', 'FR-01, BR-03', () => {
  const env = createEnvironment();
  env.click('btnSkip'); // Focus -> Short Break, slot 1
  env.click('btnSkip'); // Short Break -> Focus
  env.click('btnSkip'); // Focus -> Short Break, slot 2
  env.click('btnSkip'); // Short Break -> Focus
  env.click('btnSkip'); // Focus -> Short Break, slot 3
  assert.equal(env.app.completedSlots, 3);
  env.click('btnSkip'); // Short Break -> Focus, slot count remains 3
  assert.equal(env.app.sessionType, 'Focus');
  env.click('btnReset');
  assert.equal(env.app.sessionStatus, 'Idle');
  assert.equal(env.app.completedSlots, 3);
});

test('F04', 'FR-03, FR-05, BR-04', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  completeRunningSession(env);
  assert.equal(env.app.isMemoPending, true);
  assert.equal(env.app.sessionStatus, 'Idle');
  assert.equal(env.elements.get('timerStatus').textContent, '메모 입력 대기');
  assert(env.elements.get('timerControls').classList.contains('hidden'));
  assert(!env.elements.get('memoFormContainer').classList.contains('hidden'));
  assert.equal(env.elements.get('btnStartPauseText').textContent, '일시정지');
});

test('F05', 'FR-03, FR-05, FR-06', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  completeRunningSession(env);
  submitMemo(env, '첫 작업');
  assert.equal(env.app.isMemoPending, false);
  assert.equal(env.app.sessionType, 'ShortBreak');
  assert.equal(env.app.sessionStatus, 'Running');
  const logs = storedLogs(env);
  const day = Object.values(logs)[0];
  assert.equal(day.count, 1);
  assert.equal(day.items.length, 1);
  assert.equal(day.items[0].memo, '첫 작업');
});

test('F06', 'FR-03, FR-04, BR-01', () => {
  const env = createEnvironment();
  env.click('btnSkip'); // skipped Focus 1
  env.click('btnSkip'); // skipped Short Break
  env.click('btnSkip'); // skipped Focus 2
  env.click('btnSkip'); // skipped Short Break
  completeRunningSession(env); // normal Focus 3
  submitMemo(env, '정상 1');
  env.click('btnSkip'); // skipped Short Break
  completeRunningSession(env); // normal Focus 4
  submitMemo(env, '정상 2');
  assert.equal(env.app.sessionType, 'LongBreak');
  assert.equal(env.app.sessionStatus, 'Running');
  assert.equal(env.app.completedSlots, 0);
  assert.equal(countLogItems(env), 2);
  const day = Object.values(storedLogs(env))[0];
  assert.equal(day.count, 2);
});

test('F07', 'FR-03', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  completeRunningSession(env);
  skipMemo(env);
  assert.equal(env.app.sessionType, 'ShortBreak');
  completeRunningSession(env);
  assert.equal(env.app.sessionType, 'Focus');
  assert.equal(env.app.sessionStatus, 'Running');
});

test('F08', 'FR-04, BR-01', () => {
  const env = createEnvironment();
  env.click('btnSkip');
  assert.equal(env.app.completedSlots, 1);
  assert.equal(countLogItems(env), 0);
  assert.equal(env.app.sessionType, 'ShortBreak');
  assert.equal(env.app.sessionStatus, 'Running');
});

test('F09', 'FR-07', () => {
  const env = createEnvironment();
  setSettings(env, { focus: 1, short: 2, long: 3 });
  assert.equal(env.app.settings.focusDuration, 1);
  assert.equal(env.elements.get('timerDisplay').textContent, '01:00');
  env.click('btnStartPause');
  const before = env.app.remainingSeconds;
  setSettings(env, { focus: 2, short: 4, long: 5 });
  assert.equal(env.app.settings.focusDuration, 2);
  assert.equal(env.app.remainingSeconds, before);
  env.click('btnStartPause');
  assert.equal(env.app.sessionStatus, 'Paused');
  const paused = env.app.remainingSeconds;
  setSettings(env, { focus: 3, short: 6, long: 7 });
  assert.equal(env.app.remainingSeconds, paused);
});

test('F10', 'FR-07', () => {
  const env = createEnvironment();
  setSettings(env, { focus: 0, short: 5, long: 15 });
  assert.equal(env.app.settings.focusDuration, 25);
  assert(env.elements.get('settingsError').classList.contains('hidden') === false);
  setSettings(env, { focus: 181, short: 5, long: 15 });
  assert.equal(env.app.settings.focusDuration, 25);
  setSettings(env, { focus: 1.5, short: 5, long: 15 });
  assert.equal(env.app.settings.focusDuration, 25);
});

test('F11', 'FR-06', () => {
  const today = '2026-08-21';
  const env = createEnvironment({
    [STORAGE_KEYS.LOGS]: {
      [today]: {
        count: 2,
        items: [
          { time: '09:30:00', memo: 'late' },
          { time: '09:10:00', memo: 'early' }
        ]
      }
    }
  });
  env.click('tabLog');
  const html = env.elements.get('logList').innerHTML;
  assert(html.indexOf('09:10:00') < html.indexOf('09:30:00'));
});

test('F12', 'FR-08, EC-03', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  const before = env.app.endTimestamp;
  env.advance(7000);
  env.tick();
  const state = env.json(STORAGE_KEYS.TIMER_STATE);
  const restored = createEnvironment({
    [STORAGE_KEYS.SETTINGS]: env.json(STORAGE_KEYS.SETTINGS) || { focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15 },
    [STORAGE_KEYS.TIMER_STATE]: state,
    [STORAGE_KEYS.LOGS]: storedLogs(env)
  });
  restored.advance(7000);
  restored.tick();
  assert.equal(restored.app.sessionStatus, 'Running');
  assert.equal(restored.app.endTimestamp, before);
  assert(restored.app.remainingSeconds < 1500);
  assert(restored.app.remainingSeconds > 0);
});

test('F13', 'FR-08, EC-03', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  env.advance(9000);
  env.tick();
  env.click('btnStartPause');
  const paused = env.app.remainingSeconds;
  const restored = createEnvironment({
    [STORAGE_KEYS.SETTINGS]: env.json(STORAGE_KEYS.SETTINGS) || { focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15 },
    [STORAGE_KEYS.TIMER_STATE]: env.json(STORAGE_KEYS.TIMER_STATE),
    [STORAGE_KEYS.LOGS]: storedLogs(env)
  });
  restored.advance(86400000);
  assert.equal(restored.app.sessionStatus, 'Paused');
  assert.equal(restored.app.remainingSeconds, paused);
});

test('F14', 'FR-05, FR-08, EC-03', () => {
  const end = Date.parse('2026-08-20T23:59:00+09:00');
  const env = createEnvironment({
    [STORAGE_KEYS.TIMER_STATE]: {
      sessionType: 'Focus',
      sessionStatus: 'Running',
      endTimestamp: end,
      remainingSeconds: 1,
      currentSessionDurationSeconds: 1500,
      completedSlots: 0,
      isMemoPending: false,
      dateAnchor: end - 10000,
      perfAnchor: 1000
    }
  });
  assert.equal(env.app.isMemoPending, true);
  assert.equal(countLogItems(env), 1);
  skipMemo(env);
  assert.equal(countLogItems(env), 1);
});

test('F15', 'FR-08, EC-03, BR-02', () => {
  const env = createEnvironment({
    [STORAGE_KEYS.TIMER_STATE]: {
      sessionType: 'ShortBreak',
      sessionStatus: 'Running',
      endTimestamp: 1,
      remainingSeconds: 1,
      currentSessionDurationSeconds: 300,
      completedSlots: 1,
      isMemoPending: false
    }
  });
  assert.equal(env.app.sessionType, 'Focus');
  assert.equal(env.app.sessionStatus, 'Idle');
  assert.equal(env.app.isMemoPending, false);
});

test('F16', 'EC-04, NFR-01', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  env.advance(2000);
  env.clock.now += 10000; // local clock jumps while performance clock does not
  env.tick();
  assert.equal(env.app.sessionStatus, 'Paused');
  assert.equal(env.elements.get('clockAnomalyModal').classList.contains('hidden'), false);
});

test('F17', 'EC-04, 12.2, 13.3', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  env.visibilityChange(true);
  env.clock.now += 10000;
  env.visibilityChange(false);
  assert.equal(env.app.sessionStatus, 'Paused');
  assert.equal(env.elements.get('clockAnomalyModal').classList.contains('hidden'), false);
});

test('F18', 'BR-02, EC-02', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  completeRunningSession(env); // Focus pending
  skipMemo(env); // Short Break running
  env.visibilityChange(true);
  completeRunningSession(env);
  assert.equal(env.app.sessionType, 'ShortBreak');
  assert.equal(env.app.sessionStatus, 'Idle');
});

test('F19', 'EC-05', () => {
  const env = createEnvironment();
  env.storage.failNextWrite = true;
  env.click('btnStartPause');
  assert.equal(env.elements.get('storageWarningBanner').classList.contains('hidden'), false);
  env.click('btnStartPause');
  assert.equal(env.elements.get('storageWarningBanner').classList.contains('hidden'), true);
});

test('F20', 'FR-02, EC-01', async () => {
  const env = createEnvironment();
  env.app.onSessionComplete();
  await Promise.resolve();
  assert(env.app.notifier.titleInterval !== null);
});

test('F21', 'FR-03, BR-01, 13.1', () => {
  const env = createEnvironment();
  env.click('btnStartPause');
  completeRunningSession(env);
  const logs = storedLogs(env);
  const day = Object.values(logs)[0];
  assert.equal(day && day.count, 1);
});

test('F22', 'FR-05, FR-08', () => {
  const env = createEnvironment();
  setSettings(env, { focus: 1, short: 5, long: 15 });
  env.clock.now = new Date(2026, 7, 21, 23, 58, 30).getTime();
  env.clock.perf = 5000;
  env.click('btnStartPause');
  const originalEndTimestamp = env.app.endTimestamp;
  env.advance(60000);
  env.tick();
  assert.equal(env.app.isMemoPending, true);
  const originalDate = new Date(originalEndTimestamp);
  const expectedDate = `${originalDate.getFullYear()}-${String(originalDate.getMonth() + 1).padStart(2, '0')}-${String(originalDate.getDate()).padStart(2, '0')}`;
  env.advance(120000);
  submitMemo(env, '자정 전 작업');
  const logs = storedLogs(env);
  assert(logs[expectedDate], `expected ${expectedDate}, actual ${JSON.stringify(logs)}`);
  assert.equal(logs[expectedDate].items[0].memo, '자정 전 작업');
  assert.equal(Object.keys(logs).length, 1);
});

test('F23', 'FR-01, FR-02, 6.3', () => {
  const env = createEnvironment();
  setSettings(env, { focus: 1, short: 5, long: 15 });
  env.click('btnStartPause');
  env.advance(60001);
  env.click('btnStartPause');
  assert.equal(env.app.isMemoPending, true);
  assert.equal(env.app.sessionStatus, 'Idle');
});

test('S01', 'NFR-02, NFR-03, 12.1', () => {
  assert(!/<link\b/i.test(html));
  assert(!/<script\s+[^>]*(?:src|href)=/i.test(html));
  assert(!/(?:src|href)\s*=\s*["'](?:https?:|wss?:)/i.test(html));
  assert((html.match(/<svg\b/gi) || []).length > 0);
  assert(/window\.AudioContext|window\.webkitAudioContext/.test(html));
});

test('S02', '12.2, NFR-01', () => {
  assert(/Date\.now\(\)/.test(html));
  assert(/endTimestamp/.test(html));
  assert(/visibilitychange/.test(html));
  assert(/Math\.abs\(dateDelta - perfDelta\)/.test(html));
  assert(/diff >= 5000/.test(html));
});

async function main() {
  await Promise.all(pendingTests);
  results.sort((a, b) => a.id.localeCompare(b.id));
  for (const result of results) {
    console.log(`${result.status.padEnd(4)} ${result.id} ${result.prd}${result.error ? ` :: ${result.error}` : ''}`);
  }
  const failed = results.filter(result => result.status === 'FAIL');
  console.log(`\nIndependent tests: ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

main();

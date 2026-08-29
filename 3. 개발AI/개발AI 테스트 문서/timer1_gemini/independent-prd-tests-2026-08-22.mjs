/*
 * Independent PRD tests for gemini포모도로.html.
 * This file is intentionally self-contained and does not import or execute
 * any repository-supplied test code.
 */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const htmlUrl = new URL('./gemini포모도로.html', import.meta.url);
const html = await readFile(htmlUrl, 'utf8');
const scriptMatch = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('Inline application script was not found.');
const appScript = scriptMatch[1];

const BASE_TIME = new Date(2026, 0, 10, 9, 0, 0, 0).getTime();
const SETTINGS_KEY = 'pomodoro_settings';
const LOGS_KEY = 'pomodoro_logs';
const TIMER_KEY = 'pomodoro_timer_state';

class ClassList {
  constructor(initial = '') {
    this.tokens = new Set(String(initial).split(/\s+/).filter(Boolean));
  }
  add(...tokens) { tokens.forEach((token) => this.tokens.add(token)); }
  remove(...tokens) { tokens.forEach((token) => this.tokens.delete(token)); }
  contains(token) { return this.tokens.has(token); }
  toggle(token, force) {
    const next = force === undefined ? !this.tokens.has(token) : Boolean(force);
    if (next) this.tokens.add(token); else this.tokens.delete(token);
    return next;
  }
}

class ElementMock {
  constructor(id, initialClass = '') {
    this.id = id;
    this.classList = new ClassList(initialClass);
    this.style = {};
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.children = [];
    this.listeners = new Map();
    this.focused = false;
  }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) ?? []) callback(event);
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
  }
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    return selector === '.slot-dot' ? this.children : [];
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) { this._innerHTML = String(value); }
}

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
  const failureCounts = new Map();
  return {
    values,
    failureCounts,
    failAllWrites: false,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      const count = failureCounts.get(key) ?? 0;
      if (this.failAllWrites || count > 0) {
        if (count > 0) failureCounts.set(key, count - 1);
        throw new Error(`simulated localStorage write failure: ${key}`);
      }
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); }
  };
}

function makeFakeDate(clock) {
  return class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() { return clock.now; }
  };
}

function createHarness(options = {}) {
  const clock = {
    now: options.now ?? BASE_TIME,
    perf: options.perf ?? 0
  };
  const storage = options.storage ?? createStorage();
  const elements = new Map();
  const hiddenIds = new Set([
    'storageWarningBanner', 'clockAnomalyModal', 'viewLog', 'viewSettings',
    'memoFormContainer', 'logEmpty'
  ]);
  const ids = [
    'storageWarningBanner', 'clockAnomalyModal', 'btnResumeClockAnomaly',
    'tabTimer', 'tabLog', 'tabSettings', 'viewTimer', 'viewLog', 'viewSettings',
    'sessionBadge', 'sessionBadgeIcon', 'sessionBadgeText', 'cycleSlots',
    'timerProgressCircle', 'timerDisplay', 'timerStatus', 'timerControls',
    'btnReset', 'btnStartPause', 'btnStartPauseIcon', 'btnStartPauseText',
    'btnSkip', 'memoFormContainer', 'memoInput', 'btnMemoSubmit', 'btnMemoSkip',
    'logDatePicker', 'logCompletedCount', 'logList', 'logEmpty', 'settingsForm',
    'inputFocusDuration', 'inputShortBreakDuration', 'inputLongBreakDuration',
    'settingsError'
  ];
  for (const id of ids) elements.set(id, new ElementMock(id, hiddenIds.has(id) ? 'hidden' : ''));
  elements.get('cycleSlots').children = [0, 1, 2, 3].map((index) => new ElementMock(`slot-${index}`, 'slot-dot'));

  const documentListeners = new Map();
  const windowListeners = new Map();
  const rootStyle = { setProperty(name, value) { this[name] = value; } };
  const document = {
    title: '뽀모도로 타이머',
    hidden: false,
    documentElement: { style: rootStyle },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, callback) {
      const callbacks = documentListeners.get(type) ?? [];
      callbacks.push(callback);
      documentListeners.set(type, callbacks);
    },
    dispatch(type, event = {}) {
      for (const callback of documentListeners.get(type) ?? []) callback({ type, ...event });
    }
  };

  const timers = new Map();
  let nextTimerId = 1;
  const notifications = [];
  let oscillatorCount = 0;
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    resume() {
      if (options.audioFails) return Promise.reject(new Error('simulated audio failure'));
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      if (options.audioFails) throw new Error('simulated audio failure');
      oscillatorCount += 1;
      return {
        type: '',
        frequency: { setValueAtTime() {} },
        connect() {},
        start() {},
        stop() {}
      };
    }
    createGain() {
      if (options.audioFails) throw new Error('simulated audio failure');
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {}
      };
    }
  }
  function FakeNotification(title, detail) {
    notifications.push({ title, detail });
  }
  FakeNotification.permission = options.notificationPermission ?? 'denied';
  FakeNotification.requestPermission = () => Promise.resolve(FakeNotification.permission);

  const sandbox = {
    document,
    localStorage: storage,
    Date: makeFakeDate(clock),
    performance: { now: () => clock.perf },
    setInterval(callback, ms) {
      const id = nextTimerId++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    setTimeout(callback) { callback(); return nextTimerId++; },
    clearTimeout() {},
    console
  };
  if (options.audioEnabled !== false) sandbox.AudioContext = FakeAudioContext;
  if (options.notificationSupported !== false) sandbox.Notification = FakeNotification;
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, callback) => {
    const callbacks = windowListeners.get(type) ?? [];
    callbacks.push(callback);
    windowListeners.set(type, callbacks);
  };
  sandbox.dispatchWindow = (type, event = {}) => {
    for (const callback of windowListeners.get(type) ?? []) callback({ type, ...event });
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(appScript, context, { filename: 'gemini포모도로.html' });
  sandbox.dispatchWindow('DOMContentLoaded');

  return {
    clock,
    storage,
    document,
    elements,
    notifications,
    get oscillatorCount() { return oscillatorCount; },
    el(id) { return elements.get(id); },
    click(id) { elements.get(id).click(); },
    submitSettings() {
      elements.get('settingsForm').dispatchEvent({ type: 'submit', preventDefault() {} });
    },
    advance(dateMs, perfMs = dateMs) {
      clock.now += dateMs;
      clock.perf += perfMs;
    },
    tick() {
      for (const entry of timers.values()) if (entry.ms === 250) entry.callback();
    },
    visibility(hidden) {
      document.hidden = hidden;
      document.dispatch('visibilitychange');
    },
    countIntervals(ms) {
      return [...timers.values()].filter((entry) => entry.ms === ms).length;
    },
    json(key, fallback = null) {
      const raw = storage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function visible(harness, id) {
  return !harness.el(id).classList.contains('hidden');
}

function localDateKey(timestamp) {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function totalLogCount(harness) {
  return Object.values(harness.json(LOGS_KEY, {})).reduce((total, log) => total + (log.count ?? 0), 0);
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function saveSettings(harness, focus, shortBreak, longBreak) {
  harness.click('tabSettings');
  harness.el('inputFocusDuration').value = String(focus);
  harness.el('inputShortBreakDuration').value = String(shortBreak);
  harness.el('inputLongBreakDuration').value = String(longBreak);
  harness.submitSettings();
}

async function completeCurrentFocus(harness, memo, mode = 'submit') {
  if (harness.el('timerStatus').textContent !== '진행 중') harness.click('btnStartPause');
  const state = harness.json(TIMER_KEY);
  assert(state?.sessionType === 'Focus' && state.sessionStatus === 'Running', 'A running Focus session is required.');
  harness.advance(state.endTimestamp - harness.clock.now);
  harness.tick();
  await settle();
  assert(harness.el('timerStatus').textContent === '메모 입력 대기', 'Focus completion must present memo-input-pending state.');
  if (mode === 'skip') {
    harness.click('btnMemoSkip');
  } else {
    harness.el('memoInput').value = memo;
    harness.click('btnMemoSubmit');
  }
  await settle();
}

function seedTimer(storage, state) {
  storage.values.set(TIMER_KEY, JSON.stringify(state));
}

const results = [];
async function test(id, clauses, run) {
  try {
    await run();
    results.push({ id, clauses, status: 'PASS' });
  } catch (error) {
    results.push({ id, clauses, status: 'FAIL', detail: error.message });
  }
}

await test('T-FR01-01', ['FR-01', '13.1 Functional'], async () => {
  const h = createHarness();
  equal(h.el('timerDisplay').textContent, '25:00', 'Idle Focus must show the default length');
  h.click('btnStartPause');
  equal(h.el('timerStatus').textContent, '진행 중', 'Start must enter Running');
  h.advance(10_000);
  h.tick();
  equal(h.el('timerDisplay').textContent, '24:50', 'Displayed remaining time must follow elapsed absolute time');
  h.click('btnStartPause');
  equal(h.el('timerStatus').textContent, '일시정지', 'Pause must enter Paused');
  h.advance(60_000);
  h.tick();
  equal(h.el('timerDisplay').textContent, '24:50', 'Paused remaining time must not change');
  h.click('btnReset');
  equal(h.el('timerStatus').textContent, '대기 중', 'Reset must return to Idle');
  equal(h.el('timerDisplay').textContent, '25:00', 'Reset must restore the configured duration');
});

await test('T-FR01-02', ['FR-01', 'BR-03', '13.1 Functional'], async () => {
  const h = createHarness();
  for (let i = 0; i < 3; i += 1) {
    h.click('btnSkip');
    equal(h.el('sessionBadgeText').textContent, '짧은 휴식', 'A non-fourth skipped Focus must enter Short Break');
    h.click('btnSkip');
    equal(h.el('sessionBadgeText').textContent, '집중', 'Skipping Break must enter Focus');
  }
  h.click('btnReset');
  equal(h.json(TIMER_KEY).completedSlots, 3, 'Reset must preserve three consumed Focus slots');
  await completeCurrentFocus(h, '', 'skip');
  equal(h.el('sessionBadgeText').textContent, '긴 휴식', 'The fourth Focus after reset must enter Long Break');
});

await test('T-FR03-01', ['FR-03', 'FR-05', 'BR-04', '13.1 Functional'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  const state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.tick();
  await settle();
  equal(h.el('timerStatus').textContent, '메모 입력 대기', 'Completed Focus must enter Memo-Input-Pending');
  assert(!visible(h, 'timerControls'), 'Timer controls must be hidden while memo is pending');
  assert(visible(h, 'memoFormContainer'), 'Only memo actions must be visible while memo is pending');
  const today = localDateKey(h.clock.now);
  equal(h.json(LOGS_KEY, {})[today]?.count ?? 0, 1, 'A normally completed Focus must increment completion count before memo submission');
});

await test('T-FR03-02', ['FR-03', 'FR-05', 'BR-01', '13.1 Functional'], async () => {
  const h = createHarness();
  await completeCurrentFocus(h, '  보고서 작성  ');
  equal(h.el('sessionBadgeText').textContent, '짧은 휴식', 'First completed Focus must enter Short Break');
  equal(h.el('timerStatus').textContent, '진행 중', 'Real-time next session must auto-start');
  const log = h.json(LOGS_KEY)[localDateKey(h.clock.now)];
  equal(log.count, 1, 'One completed Focus must produce one daily completion');
  equal(log.items[0].memo, '보고서 작성', 'Submitted memo must be trimmed and stored');
});

await test('T-FR05-01', ['FR-05', 'FR-06', '13.1 Functional'], async () => {
  const blank = createHarness();
  await completeCurrentFocus(blank, '   ');
  const blankLog = blank.json(LOGS_KEY)[localDateKey(blank.clock.now)];
  equal(blankLog.count, 1, 'Blank memo submission must preserve completed count');
  equal(blankLog.items[0].memo, '', 'Blank memo submission must store an empty memo');
  blank.click('tabLog');
  assert(blank.el('logList').innerHTML.includes('메모 없음'), 'Empty memo must be rendered as 메모 없음');

  const skipped = createHarness();
  await completeCurrentFocus(skipped, '', 'skip');
  const skippedLog = skipped.json(LOGS_KEY)[localDateKey(skipped.clock.now)];
  equal(skippedLog.count, 1, 'Skipping memo must preserve completed count');
  equal(skippedLog.items[0].memo, '', 'Skipping memo must store an empty memo');
});

await test('T-FR04-01', ['FR-04', 'BR-01', '13.1 Functional'], async () => {
  const h = createHarness();
  h.click('btnSkip'); // Focus slot 1
  h.click('btnSkip'); // Short Break -> Focus
  h.click('btnSkip'); // Focus slot 2
  h.click('btnSkip'); // Short Break -> Focus
  await completeCurrentFocus(h, '정상 완료 1'); // Focus slot 3
  h.click('btnSkip'); // Short Break -> Focus
  await completeCurrentFocus(h, '정상 완료 2'); // Focus slot 4
  equal(h.el('sessionBadgeText').textContent, '긴 휴식', 'Two skipped and two completed Focus slots must lead to Long Break');
  equal(totalLogCount(h), 2, 'Skipped Focus sessions must not increase the completion count');
});

await test('T-FR04-02', ['FR-04', 'BR-01'], async () => {
  const h = createHarness();
  h.click('btnSkip');
  equal(h.el('sessionBadgeText').textContent, '짧은 휴식', 'Focus skip must start Short Break');
  h.click('btnSkip');
  equal(h.el('sessionBadgeText').textContent, '집중', 'Short Break skip must start Focus');

  const storage = createStorage();
  seedTimer(storage, {
    sessionType: 'LongBreak', sessionStatus: 'Running', endTimestamp: BASE_TIME + 900_000,
    remainingSeconds: 900, currentSessionDurationSeconds: 900, completedSlots: 0,
    isMemoPending: false, dateAnchor: BASE_TIME, perfAnchor: 0
  });
  const longBreak = createHarness({ storage });
  longBreak.click('btnSkip');
  equal(longBreak.el('sessionBadgeText').textContent, '집중', 'Long Break skip must reset cycle into Focus');
  equal(longBreak.el('timerStatus').textContent, '진행 중', 'Skip must auto-start its next session');
});

await test('T-FR06-01', ['FR-06', '13.1 Functional'], async () => {
  const h = createHarness();
  saveSettings(h, 1, 1, 1);
  await completeCurrentFocus(h, '첫 번째');
  h.advance(5_000);
  h.click('btnSkip');
  await completeCurrentFocus(h, '두 번째');
  h.click('tabLog');
  equal(h.el('logCompletedCount').textContent, '2', 'Log count must equal normally completed Focus sessions');
  const markup = h.el('logList').innerHTML;
  assert(markup.indexOf('첫 번째') < markup.indexOf('두 번째'), 'Memo list must be displayed oldest-first');
});

await test('T-FR07-01', ['FR-07', '13.1 Functional'], async () => {
  const h = createHarness();
  saveSettings(h, 7, 8, 9);
  equal(h.el('timerDisplay').textContent, '07:00', 'Idle Focus setting must apply immediately');
  const persisted = h.json(SETTINGS_KEY);
  equal(persisted.focusDuration, 7, 'Focus setting must persist');
  equal(persisted.shortBreakDuration, 8, 'Short Break setting must persist');
  equal(persisted.longBreakDuration, 9, 'Long Break setting must persist');
  const restored = createHarness({ storage: h.storage, now: h.clock.now + 1_000 });
  equal(restored.el('timerDisplay').textContent, '07:00', 'Saved Idle setting must survive reload');
});

await test('T-FR07-02', ['FR-07', '13.1 Functional'], async () => {
  const expected = ['inputFocusDuration', 'inputShortBreakDuration', 'inputLongBreakDuration'];
  for (const id of expected) {
    const tag = html.match(new RegExp(`<input[^>]*id=["']${id}["'][^>]*>`, 'i'))?.[0] ?? '';
    assert(/type=["']number["']/i.test(tag), `${id} must be a numeric input`);
    assert(/min=["']1["']/i.test(tag), `${id} must enforce a minimum of 1`);
    assert(/max=["']180["']/i.test(tag), `${id} must enforce a maximum of 180`);
    assert(/step=["']1["']/i.test(tag), `${id} must enforce integer steps`);
    assert(/\brequired\b/i.test(tag), `${id} must reject an empty value`);
  }
});

await test('T-FR07-03', ['FR-07', '13.1 Functional'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.advance(10_000);
  h.tick();
  saveSettings(h, 1, 1, 1);
  equal(h.el('timerDisplay').textContent, '24:50', 'Running Focus must retain its original remaining time after settings save');
  let state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.tick();
  await settle();
  h.click('btnMemoSkip');
  h.click('btnSkip');
  equal(h.el('timerDisplay').textContent, '01:00', 'The next Focus session must use the new setting');
});

await test('T-FR07-04', ['FR-07', '13.1 Functional'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.advance(10_000);
  h.tick();
  h.click('btnStartPause');
  saveSettings(h, 2, 1, 1);
  equal(h.el('timerDisplay').textContent, '24:50', 'Paused Focus must retain its original remaining snapshot after settings save');
  h.click('btnStartPause');
  const state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.tick();
  await settle();
  h.click('btnMemoSkip');
  h.click('btnSkip');
  equal(h.el('timerDisplay').textContent, '02:00', 'Focus after paused session completes must use the new setting');
});

await test('T-FR08-01', ['FR-08', 'EC-03', '13.1 Functional'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.advance(17_000);
  h.tick();
  const restored = createHarness({ storage: h.storage, now: h.clock.now + 5_000, perf: 0 });
  equal(restored.el('timerStatus').textContent, '진행 중', 'Unexpired Running session must restore as Running');
  equal(restored.el('timerDisplay').textContent, '24:38', 'Running session must continue from absolute end timestamp after reload');
});

await test('T-FR08-02', ['FR-08', 'FR-06', 'FR-07', '13.3 User'], async () => {
  const h = createHarness();
  saveSettings(h, 1, 1, 1);
  await completeCurrentFocus(h, '보존 메모');
  h.click('btnSkip');
  h.advance(10_000);
  h.tick();
  const restored = createHarness({ storage: h.storage, now: h.clock.now + 3_000, perf: 0 });
  equal(restored.el('timerDisplay').textContent, '00:47', 'Reload must retain running remaining time');
  restored.click('tabLog');
  equal(restored.el('logCompletedCount').textContent, '1', 'Reload must retain log count');
  assert(restored.el('logList').innerHTML.includes('보존 메모'), 'Reload must retain memo content');
  restored.click('tabSettings');
  equal(restored.el('inputFocusDuration').value, 1, 'Reload must retain settings');
});

await test('T-EC03-01', ['FR-08', 'EC-03', '13.2 System'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.advance(12_000);
  h.tick();
  h.click('btnStartPause');
  const pausedDisplay = h.el('timerDisplay').textContent;
  const restored = createHarness({ storage: h.storage, now: h.clock.now + 86_400_000, perf: 0 });
  equal(restored.el('timerStatus').textContent, '일시정지', 'Paused session must remain Paused after any offline duration');
  equal(restored.el('timerDisplay').textContent, pausedDisplay, 'Paused snapshot must not decay while offline');
});

await test('T-EC03-02', ['FR-08', 'EC-03', 'BR-02', '13.2 System'], async () => {
  const storage = createStorage();
  seedTimer(storage, {
    sessionType: 'ShortBreak', sessionStatus: 'Running', endTimestamp: BASE_TIME - 7_200_000,
    remainingSeconds: 1, currentSessionDurationSeconds: 300, completedSlots: 1,
    isMemoPending: false, dateAnchor: BASE_TIME - 7_500_000, perfAnchor: 0
  });
  const h = createHarness({ storage, now: BASE_TIME });
  equal(h.el('sessionBadgeText').textContent, '집중', 'Expired Break on reload must advance only once to Focus');
  equal(h.el('timerStatus').textContent, '대기 중', 'Expired Break on reload must leave next session Idle');
});

await test('T-EC03-03', ['FR-05', 'FR-08', 'EC-03', 'BR-02', '13.2 System'], async () => {
  const originalEnd = new Date(2026, 0, 10, 23, 59, 0, 0).getTime();
  const storage = createStorage();
  seedTimer(storage, {
    sessionType: 'Focus', sessionStatus: 'Running', endTimestamp: originalEnd,
    remainingSeconds: 1, currentSessionDurationSeconds: 60, completedSlots: 0,
    isMemoPending: false, dateAnchor: originalEnd - 60_000, perfAnchor: 0
  });
  const h = createHarness({ storage, now: originalEnd + 86_400_000, perf: 0 });
  equal(h.el('timerStatus').textContent, '메모 입력 대기', 'Expired Focus on reload must present memo flow');
  h.advance(5_000);
  h.el('memoInput').value = '사후 메모';
  h.click('btnMemoSubmit');
  await settle();
  equal(totalLogCount(h), 1, 'Expired Focus plus memo submission must create exactly one completion record');
});

await test('T-EC03-04', ['FR-08', 'EC-03', 'BR-02', '13.2 System'], async () => {
  const originalEnd = new Date(2026, 0, 10, 23, 59, 0, 0).getTime();
  const storage = createStorage();
  seedTimer(storage, {
    sessionType: 'Focus', sessionStatus: 'Running', endTimestamp: originalEnd,
    remainingSeconds: 1, currentSessionDurationSeconds: 60, completedSlots: 0,
    isMemoPending: false, dateAnchor: originalEnd - 60_000, perfAnchor: 0
  });
  const h = createHarness({ storage, now: originalEnd + 86_400_000, perf: 0 });
  h.click('btnMemoSkip');
  await settle();
  equal(h.el('timerStatus').textContent, '대기 중', 'After restored-expired Focus memo flow, next session must wait Idle');
});

await test('T-EC03-05', ['FR-05', 'FR-08', 'EC-03'], async () => {
  const originalEnd = new Date(2026, 0, 10, 23, 59, 0, 0).getTime();
  const storage = createStorage();
  seedTimer(storage, {
    sessionType: 'Focus', sessionStatus: 'Running', endTimestamp: originalEnd,
    remainingSeconds: 1, currentSessionDurationSeconds: 60, completedSlots: 0,
    isMemoPending: false, dateAnchor: originalEnd - 60_000, perfAnchor: 0
  });
  const h = createHarness({ storage, now: originalEnd + 86_400_000, perf: 0 });
  h.el('memoInput').value = '사후 메모';
  h.click('btnMemoSubmit');
  const originalLog = h.json(LOGS_KEY)[localDateKey(originalEnd)];
  equal(originalLog?.items?.[0]?.memo, '사후 메모', 'Restored-expired Focus memo must remain attached to the original completion timestamp');
});

await test('T-FR05-02', ['FR-05', 'FR-06', 'FR-08'], async () => {
  const h = createHarness({ now: new Date(2026, 0, 10, 23, 58, 30, 0).getTime() });
  saveSettings(h, 1, 1, 1);
  h.click('btnStartPause');
  const state = h.json(TIMER_KEY);
  const completionTimestamp = state.endTimestamp;
  h.advance(completionTimestamp - h.clock.now);
  h.tick();
  await settle();
  h.advance(86_400_000);
  h.el('memoInput').value = '다음 날 입력';
  h.click('btnMemoSubmit');
  const expectedDate = localDateKey(completionTimestamp);
  const expectedLog = h.json(LOGS_KEY)[expectedDate];
  equal(expectedLog?.count ?? 0, 1, 'Memo must be stored under the Focus completion date, not its later submission date');
  equal(expectedLog.items[0].memo, '다음 날 입력', 'Memo text must accompany its completion record');
});

await test('T-EC02-01', ['EC-02', 'FR-03'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.visibility(true);
  const state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.visibility(false);
  await settle();
  equal(h.el('timerStatus').textContent, '메모 입력 대기', 'Returning to a background-expired Focus must immediately recompute completion');
  assert(!visible(h, 'timerControls') && visible(h, 'memoFormContainer'), 'Background correction must continue into memo flow');
});

await test('T-EC04-01', ['EC-04', 'NFR-01', '12.2', '13.3 User'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.advance(5_000, 0);
  h.tick();
  equal(h.el('timerStatus').textContent, '일시정지', 'A 5-second Date/performance delta mismatch must pause timer');
  assert(visible(h, 'clockAnomalyModal'), 'Clock anomaly must show confirmation UI');
  h.click('btnResumeClockAnomaly');
  equal(h.el('timerStatus').textContent, '진행 중', 'User confirmation must resume timer');
});

await test('T-EC05-01', ['EC-05', '13.1 Functional', '13.3 User'], async () => {
  const h = createHarness();
  h.storage.failAllWrites = true;
  h.click('btnStartPause');
  equal(h.el('timerStatus').textContent, '진행 중', 'Timer must remain usable while localStorage writes fail');
  assert(visible(h, 'storageWarningBanner'), 'Write failure must show a visible warning');
  h.storage.failAllWrites = false;
  h.click('btnStartPause');
  assert(!visible(h, 'storageWarningBanner'), 'Successful retry must clear the write-failure warning');
});

await test('T-EC05-02', ['EC-05'], async () => {
  const h = createHarness();
  h.storage.failureCounts.set(SETTINGS_KEY, 1);
  saveSettings(h, 7, 8, 9);
  assert(visible(h, 'storageWarningBanner'), 'Failed settings write must show storage warning');
  h.click('btnStartPause');
  const restored = createHarness({ storage: h.storage, now: h.clock.now + 1_000, perf: 0 });
  restored.click('tabSettings');
  equal(restored.el('inputFocusDuration').value, 7, 'A failed settings write must be retried on subsequent state changes before warning clears');
});

await test('T-FR02-01', ['FR-02', '12.2'], async () => {
  const h = createHarness({ notificationPermission: 'granted' });
  h.click('btnStartPause');
  const state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.tick();
  await settle();
  assert(h.oscillatorCount > 0, 'Session completion must attempt synthesized sound');
  equal(h.notifications.length, 1, 'Granted Notification permission must invoke browser notification with sound');
});

await test('T-EC01-01', ['EC-01', 'FR-02'], async () => {
  const h = createHarness({ notificationPermission: 'denied' });
  h.click('btnStartPause');
  const state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.tick();
  await settle();
  assert(h.oscillatorCount > 0, 'Denied notification must still attempt sound');
  equal(h.notifications.length, 0, 'Denied notification must not construct browser notification');
  assert(h.countIntervals(800) > 0, 'Denied notification must use title-flash fallback');
});

await test('T-EC01-02', ['EC-01', 'FR-02'], async () => {
  const h = createHarness({ notificationSupported: false });
  h.click('btnStartPause');
  const state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.tick();
  await settle();
  assert(h.oscillatorCount > 0, 'Unsupported Notification API must still attempt sound');
  assert(h.countIntervals(800) > 0, 'Unsupported Notification API must use title-flash fallback');
});

await test('T-FR02-02', ['FR-02', 'EC-01'], async () => {
  const h = createHarness({ notificationPermission: 'granted', audioEnabled: false });
  h.click('btnStartPause');
  const state = h.json(TIMER_KEY);
  h.advance(state.endTimestamp - h.clock.now);
  h.tick();
  await settle();
  equal(h.notifications.length, 1, 'Audio failure must not suppress granted Notification invocation');
  assert(h.countIntervals(800) > 0, 'Audio failure must immediately use title-flash fallback');
});

await test('T-NFR01-01', ['NFR-01', '12.2', '13.3 User'], async () => {
  const h = createHarness();
  saveSettings(h, 180, 1, 1);
  h.click('btnStartPause');
  h.advance(10_799_000);
  h.tick();
  equal(h.el('timerDisplay').textContent, '00:01', 'After a simulated 2h59m59s elapsed interval, one second must remain');
  h.advance(1_000);
  h.tick();
  equal(h.el('timerStatus').textContent, '메모 입력 대기', 'Absolute timestamp timer must finish exactly at its end timestamp');
});

await test('T-NFR02-03-01', ['NFR-02', 'NFR-03', '3.2', '12.1', '13.2 System'], async () => {
  const externalResources = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((value) => /^(?:https?:)?\/\//i.test(value));
  equal(externalResources.length, 0, 'Single-file app must not declare external network resources');
  assert(!/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/i.test(html), 'App must not use network APIs');
  assert(!/<script\b[^>]*\bsrc=/i.test(html), 'App must not depend on external script files');
  assert(!/\blocalStorage\.(?:removeItem|clear)\s*\(/i.test(html), 'App must not add an in-app data deletion action');
  assert(!/\bReact\b|\bVue\b|\bAngular\b/i.test(html), 'App must remain framework-free');
  assert(/<svg\b/i.test(html), 'Graphics must be supplied inline as SVG');
});

await test('T-UA-01', ['13.3 User (daily usage)'], async () => {
  const h = createHarness();
  saveSettings(h, 1, 1, 1);
  h.click('btnStartPause');
  h.advance(60_000);
  h.tick();
  await settle();
  h.advance(5_000);
  h.el('memoInput').value = '하루 작업';
  h.click('btnMemoSubmit');
  h.click('tabLog');
  equal(h.el('logCompletedCount').textContent, '1', 'Daily user flow must show one completed pomodoro');
  assert(h.el('logList').innerHTML.includes('하루 작업'), 'Daily user flow must show submitted memo');
});

await test('T-UA-02', ['13.3 User (refresh/restart)'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.advance(22_000);
  h.tick();
  const restored = createHarness({ storage: h.storage, now: h.clock.now + 4_000, perf: 0 });
  equal(restored.el('timerDisplay').textContent, '24:34', 'User refresh flow must preserve elapsed progress');
});

await test('T-UA-03', ['13.3 User (long-running timer)'], async () => {
  const h = createHarness();
  saveSettings(h, 180, 1, 1);
  h.click('btnStartPause');
  h.advance(7_200_000);
  h.tick();
  equal(h.el('timerDisplay').textContent, '60:00', 'After a simulated two-hour delay, displayed remaining time must match elapsed time');
});

await test('T-UA-04', ['13.3 User (clock change)'], async () => {
  const h = createHarness();
  h.click('btnStartPause');
  h.advance(6_000, 0);
  h.tick();
  equal(h.el('timerStatus').textContent, '일시정지', 'User clock-change flow must stop safely rather than alter time');
  assert(visible(h, 'clockAnomalyModal'), 'User clock-change flow must request confirmation');
});

await test('T-UA-05', ['13.3 User (storage failure)'], async () => {
  const h = createHarness();
  h.storage.failAllWrites = true;
  h.click('btnStartPause');
  h.advance(1_000);
  h.tick();
  equal(h.el('timerStatus').textContent, '진행 중', 'User can continue timer after storage failure');
  assert(visible(h, 'storageWarningBanner'), 'User sees storage-failure warning during continued use');
});

export { results };
export const summary = {
  total: results.length,
  passed: results.filter((result) => result.status === 'PASS').length,
  failed: results.filter((result) => result.status === 'FAIL').length
};

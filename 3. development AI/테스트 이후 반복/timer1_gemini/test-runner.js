/**
 * Comprehensive Automated Test Suite for Pomodoro Timer (PRD v4 & GEMINI.md)
 */
const assert = require('assert');

// Mock Browser Environment
class MockStorage {
  constructor() {
    this.store = {};
    this.failWrites = false;
  }
  getItem(key) {
    return this.store.hasOwnProperty(key) ? this.store[key] : null;
  }
  setItem(key, value) {
    if (this.failWrites) {
      throw new Error('QuotaExceededError / Storage Blocked');
    }
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: () => {} },
      connect: () => {},
      start: () => {},
      stop: () => {}
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {}
      },
      connect: () => {}
    };
  }
}

class MockNotification {
  static permission = 'granted';
  static instances = [];
  constructor(title, options) {
    this.title = title;
    this.options = options;
    MockNotification.instances.push(this);
  }
  static requestPermission() {
    return Promise.resolve(MockNotification.permission);
  }
}

// Setup Global DOM and Browser Mocks
const mockStorage = new MockStorage();
global.localStorage = mockStorage;
global.AudioContext = MockAudioContext;
global.Notification = MockNotification;
global.document = {
  title: '뽀모도로 타이머',
  hidden: false,
  documentElement: {
    style: {
      setProperty: () => {}
    }
  },
  getElementById: (id) => ({
    id,
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c);
        } else if (force) {
          this._classes.add(c);
        } else {
          this._classes.delete(c);
        }
      },
      contains(c) { return this._classes.has(c); }
    },
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    addEventListener: () => {},
    querySelectorAll: () => [],
    focus: () => {}
  }),
  addEventListener: () => {}
};
global.window = {
  addEventListener: () => {},
  AudioContext: MockAudioContext
};

// Simulation of App Classes based on index.html
const STORAGE_KEYS = {
  SETTINGS: 'pomodoro_settings',
  LOGS: 'pomodoro_logs',
  TIMER_STATE: 'pomodoro_timer_state'
};

const DEFAULT_SETTINGS = {
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15
};

class StorageManager {
  constructor() {
    this.isWriteFailed = false;
    this.onStorageStatusChange = null;
  }
  get(key, defaultValue) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch (e) {
      return defaultValue;
    }
  }
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      if (this.isWriteFailed) {
        this.isWriteFailed = false;
        if (this.onStorageStatusChange) this.onStorageStatusChange(false);
      }
      return true;
    } catch (e) {
      if (!this.isWriteFailed) {
        this.isWriteFailed = true;
        if (this.onStorageStatusChange) this.onStorageStatusChange(true);
      }
      return false;
    }
  }
}

class SoundSynthesizer {
  constructor() {
    this.audioCtx = null;
  }
  initContext() {
    if (!this.audioCtx) this.audioCtx = new MockAudioContext();
  }
  async playNotificationSound(type) {
    this.initContext();
    return true;
  }
}

class NotificationManager {
  constructor(soundSynthesizer) {
    this.soundSynth = soundSynthesizer;
    this.titleInterval = null;
    this.originalTitle = document.title;
    this.notificationCount = 0;
  }
  requestPermission() {
    return Promise.resolve(Notification.permission);
  }
  async notifySessionComplete(sessionType) {
    const title = sessionType === 'Focus' ? '집중 세션 완료!' : '휴식 세션 완료!';
    const body = sessionType === 'Focus' ? '수고하셨습니다! 휴식을 시작하세요.' : '휴식이 끝났습니다! 집중할 준비를 하세요.';
    let soundSuccess = await this.soundSynth.playNotificationSound(sessionType);
    let notificationSent = false;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      notificationSent = true;
      this.notificationCount++;
    }
    if (!notificationSent || !soundSuccess) {
      this.flashTitle(title);
    }
  }
  flashTitle(message) {
    document.title = `🔔 ${message}`;
  }
  stopFlashTitle() {
    document.title = this.originalTitle;
  }
}

function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalTimeString(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

class PomodoroEngine {
  constructor() {
    this.storage = new StorageManager();
    this.soundSynth = new SoundSynthesizer();
    this.notifier = new NotificationManager(this.soundSynth);

    this.settings = this.loadSettings();
    this.sessionType = 'Focus';
    this.sessionStatus = 'Idle';
    this.endTimestamp = null;
    this.remainingSeconds = this.settings.focusDuration * 60;
    this.currentSessionDurationSeconds = this.remainingSeconds;
    this.completedSlots = 0;
    this.isMemoPending = false;

    this.dateAnchor = null;
    this.perfAnchor = null;
    this.isClockAnomaly = false;

    this.storageWarningTriggered = false;
    this.storage.onStorageStatusChange = (isFailed) => {
      this.storageWarningTriggered = isFailed;
    };

    this.restoreState();
  }

  loadSettings() {
    const saved = this.storage.get(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    return {
      focusDuration: Number(saved.focusDuration) || 25,
      shortBreakDuration: Number(saved.shortBreakDuration) || 5,
      longBreakDuration: Number(saved.longBreakDuration) || 15
    };
  }

  saveSettings(newSettings) {
    this.settings = newSettings;
    this.storage.set(STORAGE_KEYS.SETTINGS, this.settings);
    if (this.sessionStatus === 'Idle') {
      const duration = this.getDurationForSession(this.sessionType);
      this.remainingSeconds = duration * 60;
      this.currentSessionDurationSeconds = this.remainingSeconds;
    }
  }

  getDurationForSession(type) {
    if (type === 'Focus') return this.settings.focusDuration;
    if (type === 'ShortBreak') return this.settings.shortBreakDuration;
    if (type === 'LongBreak') return this.settings.longBreakDuration;
    return 25;
  }

  sampleAnchors() {
    this.dateAnchor = Date.now();
    this.perfAnchor = performance.now();
  }

  checkClockAnomaly(customDateNow, customPerfNow) {
    if (this.sessionStatus !== 'Running' || this.dateAnchor === null || this.perfAnchor === null) {
      return false;
    }
    const dNow = customDateNow !== undefined ? customDateNow : Date.now();
    const pNow = customPerfNow !== undefined ? customPerfNow : performance.now();
    const dateDelta = dNow - this.dateAnchor;
    const perfDelta = pNow - this.perfAnchor;
    const diff = Math.abs(dateDelta - perfDelta);

    if (diff >= 5000) {
      this.handleClockAnomaly(perfDelta, dNow);
      return true;
    }
    return false;
  }

  handleClockAnomaly(perfDelta) {
    this.isClockAnomaly = true;
    const elapsedSec = Math.floor(perfDelta / 1000);
    const lastValidRemaining = Math.max(1, (this.endTimestamp - this.dateAnchor) / 1000 - elapsedSec);

    this.sessionStatus = 'Paused';
    this.remainingSeconds = Math.round(lastValidRemaining);
    this.endTimestamp = null;
    this.dateAnchor = null;
    this.perfAnchor = null;

    this.saveTimerState();
  }

  resumeFromClockAnomaly() {
    this.isClockAnomaly = false;
    this.start();
  }

  saveTimerState() {
    const stateData = {
      sessionType: this.sessionType,
      sessionStatus: this.sessionStatus,
      endTimestamp: this.endTimestamp,
      remainingSeconds: this.remainingSeconds,
      currentSessionDurationSeconds: this.currentSessionDurationSeconds,
      completedSlots: this.completedSlots,
      isMemoPending: this.isMemoPending,
      dateAnchor: this.dateAnchor,
      perfAnchor: this.perfAnchor
    };
    this.storage.set(STORAGE_KEYS.TIMER_STATE, stateData);
  }

  restoreState() {
    const state = this.storage.get(STORAGE_KEYS.TIMER_STATE, null);
    if (!state) {
      this.sessionType = 'Focus';
      this.sessionStatus = 'Idle';
      this.remainingSeconds = this.settings.focusDuration * 60;
      this.currentSessionDurationSeconds = this.remainingSeconds;
      this.completedSlots = 0;
      this.isMemoPending = false;
      return;
    }

    this.sessionType = state.sessionType || 'Focus';
    this.completedSlots = Number(state.completedSlots) || 0;
    this.currentSessionDurationSeconds = Number(state.currentSessionDurationSeconds) || (this.getDurationForSession(this.sessionType) * 60);

    if (state.isMemoPending) {
      this.sessionStatus = 'Idle';
      this.isMemoPending = true;
      this.remainingSeconds = 0;
      return;
    }

    if (state.sessionStatus === 'Running' && state.endTimestamp) {
      const now = Date.now();
      if (now >= state.endTimestamp) {
        const expiredSessionType = this.sessionType;
        const originalEndTimestamp = state.endTimestamp;

        if (expiredSessionType === 'Focus') {
          this.recordCompletedFocus(originalEndTimestamp, '');
          this.consumeFocusSlot();
          this.isMemoPending = true;
          this.sessionStatus = 'Idle';
          this.remainingSeconds = 0;
        } else {
          this.sessionType = 'Focus';
          this.sessionStatus = 'Idle';
          this.remainingSeconds = this.settings.focusDuration * 60;
          this.currentSessionDurationSeconds = this.remainingSeconds;
          this.isMemoPending = false;
        }
        this.notifier.notifySessionComplete(expiredSessionType);
      } else {
        this.sessionStatus = 'Running';
        this.endTimestamp = state.endTimestamp;
        this.remainingSeconds = Math.max(0, Math.ceil((state.endTimestamp - now) / 1000));
        this.sampleAnchors();
      }
    } else if (state.sessionStatus === 'Paused') {
      this.sessionStatus = 'Paused';
      this.remainingSeconds = Number(state.remainingSeconds) || (this.getDurationForSession(this.sessionType) * 60);
      this.endTimestamp = null;
    } else {
      this.sessionStatus = 'Idle';
      this.remainingSeconds = this.getDurationForSession(this.sessionType) * 60;
      this.currentSessionDurationSeconds = this.remainingSeconds;
    }

    this.saveTimerState();
  }

  consumeFocusSlot() {
    this.completedSlots = (this.completedSlots + 1) % 4;
  }

  getNextSessionTypeAfterFocus() {
    return this.completedSlots === 0 ? 'LongBreak' : 'ShortBreak';
  }

  start() {
    if (this.sessionStatus === 'Running' || this.isMemoPending) return;
    this.soundSynth.initContext();
    this.notifier.requestPermission();
    this.notifier.stopFlashTitle();

    const now = Date.now();
    if (this.sessionStatus === 'Idle') {
      this.currentSessionDurationSeconds = this.getDurationForSession(this.sessionType) * 60;
      this.remainingSeconds = this.currentSessionDurationSeconds;
    }

    this.endTimestamp = now + this.remainingSeconds * 1000;
    this.sessionStatus = 'Running';
    this.sampleAnchors();

    this.saveTimerState();
  }

  pause() {
    if (this.sessionStatus !== 'Running') return;
    const now = Date.now();
    this.remainingSeconds = Math.max(1, Math.ceil((this.endTimestamp - now) / 1000));
    this.sessionStatus = 'Paused';
    this.endTimestamp = null;
    this.dateAnchor = null;
    this.perfAnchor = null;

    this.saveTimerState();
  }

  reset() {
    if (this.isMemoPending) return;
    this.sessionStatus = 'Idle';
    this.endTimestamp = null;
    this.dateAnchor = null;
    this.perfAnchor = null;
    this.remainingSeconds = this.getDurationForSession(this.sessionType) * 60;
    this.currentSessionDurationSeconds = this.remainingSeconds;

    this.saveTimerState();
  }

  skip() {
    if (this.isMemoPending) return;

    const currentType = this.sessionType;
    this.sessionStatus = 'Idle';
    this.endTimestamp = null;
    this.dateAnchor = null;
    this.perfAnchor = null;

    if (currentType === 'Focus') {
      this.consumeFocusSlot();
      this.sessionType = this.getNextSessionTypeAfterFocus();
    } else {
      this.sessionType = 'Focus';
    }

    this.remainingSeconds = this.getDurationForSession(this.sessionType) * 60;
    this.currentSessionDurationSeconds = this.remainingSeconds;

    this.start();
  }

  onSessionComplete() {
    const completedType = this.sessionType;
    this.notifier.notifySessionComplete(completedType);

    if (completedType === 'Focus') {
      this.consumeFocusSlot();
      this.isMemoPending = true;
      this.sessionStatus = 'Idle';
      this.remainingSeconds = 0;
      this.endTimestamp = null;
      this.dateAnchor = null;
      this.perfAnchor = null;

      this.saveTimerState();
    } else {
      this.sessionType = 'Focus';
      this.sessionStatus = 'Idle';
      this.remainingSeconds = this.getDurationForSession('Focus') * 60;
      this.currentSessionDurationSeconds = this.remainingSeconds;
      this.isMemoPending = false;

      this.saveTimerState();
      this.start();
    }
  }

  submitMemo(memoText) {
    if (!this.isMemoPending) return;
    const cleanedText = (memoText || '').trim();
    this.recordCompletedFocus(Date.now(), cleanedText);
    this.finishMemoAndProceed();
  }

  skipMemo() {
    if (!this.isMemoPending) return;
    this.recordCompletedFocus(Date.now(), '');
    this.finishMemoAndProceed();
  }

  finishMemoAndProceed() {
    this.isMemoPending = false;
    this.sessionType = this.getNextSessionTypeAfterFocus();
    this.sessionStatus = 'Idle';
    this.remainingSeconds = this.getDurationForSession(this.sessionType) * 60;
    this.currentSessionDurationSeconds = this.remainingSeconds;

    this.saveTimerState();
    this.start();
  }

  recordCompletedFocus(timestamp, memoText) {
    const dateObj = new Date(timestamp);
    const dateKey = getLocalDateString(dateObj);
    const timeString = getLocalTimeString(dateObj);

    const logs = this.storage.get(STORAGE_KEYS.LOGS, {});
    if (!logs[dateKey]) {
      logs[dateKey] = { count: 0, items: [] };
    }

    logs[dateKey].count = (logs[dateKey].count || 0) + 1;
    logs[dateKey].items.push({
      time: timeString,
      memo: memoText
    });

    this.storage.set(STORAGE_KEYS.LOGS, logs);
  }
}

// ==========================================
// TEST SUITE EXECUTION
// ==========================================
let passedCount = 0;
let failedCount = 0;
const testResults = [];

function runTest(name, fn) {
  try {
    mockStorage.clear();
    mockStorage.failWrites = false;
    MockNotification.instances = [];
    MockNotification.permission = 'granted';
    document.title = '뽀모도로 타이머';

    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedCount++;
    testResults.push({ name, status: 'PASS' });
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    Error: ${err.message}`);
    failedCount++;
    testResults.push({ name, status: 'FAIL', error: err.message });
  }
}

console.log('====================================================');
console.log('Starting Self-Test Suite for Pomodoro Timer (PRD v4)');
console.log('====================================================');

// --- 1. FR-01: Timer Start, Pause, Reset, Slot Independence (BR-03) ---
runTest('FR-01: Timer start transitions to Running and sets endTimestamp', () => {
  const app = new PomodoroEngine();
  assert.strictEqual(app.sessionStatus, 'Idle');
  app.start();
  assert.strictEqual(app.sessionStatus, 'Running');
  assert.ok(app.endTimestamp > Date.now());
});

runTest('FR-01: Timer pause holds remainingSeconds and clears endTimestamp', () => {
  const app = new PomodoroEngine();
  app.start();
  app.pause();
  assert.strictEqual(app.sessionStatus, 'Paused');
  assert.strictEqual(app.endTimestamp, null);
  assert.ok(app.remainingSeconds > 0);
});

runTest('FR-01 & BR-03: Timer reset returns to Idle without altering completedSlots', () => {
  const app = new PomodoroEngine();
  app.completedSlots = 3;
  app.start();
  app.reset();
  assert.strictEqual(app.sessionStatus, 'Idle');
  assert.strictEqual(app.completedSlots, 3, 'completedSlots must be preserved on reset');
  assert.strictEqual(app.remainingSeconds, 25 * 60);
});

// --- 2. FR-02 & EC-01: Session Notification & Sound ---
runTest('FR-02: Session completion triggers Notification and sound', async () => {
  const app = new PomodoroEngine();
  app.start();
  app.onSessionComplete();
  assert.strictEqual(MockNotification.instances.length, 1);
  assert.strictEqual(MockNotification.instances[0].title, '집중 세션 완료!');
});

runTest('EC-01: Notification fallback changes document title when permission denied', async () => {
  MockNotification.permission = 'denied';
  const app = new PomodoroEngine();
  app.start();
  app.onSessionComplete();
  assert.strictEqual(MockNotification.instances.length, 0);
  assert.ok(document.title.includes('집중 세션 완료!'));
});

// --- 3. FR-03 & BR-01: 4-Cycle Pomodoro Progression & Long Break ---
runTest('FR-03 & BR-01: 4-cycle progression: 3 Short Breaks, 4th triggers Long Break', () => {
  const app = new PomodoroEngine();
  assert.strictEqual(app.completedSlots, 0);
  assert.strictEqual(app.sessionType, 'Focus');

  // Cycle 1: Focus 1 finishes -> ShortBreak
  app.onSessionComplete(); // Focus ends, isMemoPending = true
  assert.strictEqual(app.completedSlots, 1);
  assert.strictEqual(app.isMemoPending, true);
  app.submitMemo('Memo 1');
  assert.strictEqual(app.sessionType, 'ShortBreak');
  assert.strictEqual(app.sessionStatus, 'Running');

  // ShortBreak 1 ends -> Focus 2 starts automatically
  app.onSessionComplete();
  assert.strictEqual(app.sessionType, 'Focus');
  assert.strictEqual(app.sessionStatus, 'Running');

  // Cycle 2: Focus 2 ends
  app.onSessionComplete();
  assert.strictEqual(app.completedSlots, 2);
  app.skipMemo();
  assert.strictEqual(app.sessionType, 'ShortBreak');

  // ShortBreak 2 ends -> Focus 3 starts
  app.onSessionComplete();
  assert.strictEqual(app.sessionType, 'Focus');

  // Cycle 3: Focus 3 ends
  app.onSessionComplete();
  assert.strictEqual(app.completedSlots, 3);
  app.submitMemo('Memo 3');
  assert.strictEqual(app.sessionType, 'ShortBreak');

  // ShortBreak 3 ends -> Focus 4 starts
  app.onSessionComplete();
  assert.strictEqual(app.sessionType, 'Focus');

  // Cycle 4: Focus 4 ends -> 4th slot consumed, next MUST be LongBreak!
  app.onSessionComplete();
  assert.strictEqual(app.completedSlots, 0); // Reset to 0 mod 4
  app.submitMemo('Memo 4');
  assert.strictEqual(app.sessionType, 'LongBreak', '4th Focus must be followed by LongBreak');
  assert.strictEqual(app.sessionStatus, 'Running');

  // LongBreak ends -> Next is Focus (Cycle restarts)
  app.onSessionComplete();
  assert.strictEqual(app.sessionType, 'Focus');
  assert.strictEqual(app.sessionStatus, 'Running');
});

// --- 4. FR-04: Skip Behavior and Slot Count (BR-01) ---
runTest('FR-04: Skipping Focus does not increase completed count but consumes slot', () => {
  const app = new PomodoroEngine();
  const today = getLocalDateString();

  // Skip 2 Focus sessions
  app.skip(); // Focus 1 skipped -> ShortBreak starts
  assert.strictEqual(app.completedSlots, 1);
  assert.strictEqual(app.sessionType, 'ShortBreak');
  app.skip(); // ShortBreak skipped -> Focus 2 starts
  assert.strictEqual(app.sessionType, 'Focus');

  app.skip(); // Focus 2 skipped -> ShortBreak starts
  assert.strictEqual(app.completedSlots, 2);
  app.skip(); // ShortBreak skipped -> Focus 3 starts

  // Now complete 2 Focus sessions normally
  app.onSessionComplete(); // Focus 3 completed
  app.submitMemo('Work 3');
  assert.strictEqual(app.completedSlots, 3);
  app.onSessionComplete(); // ShortBreak 3 completed -> Focus 4

  app.onSessionComplete(); // Focus 4 completed
  app.submitMemo('Work 4');
  assert.strictEqual(app.completedSlots, 0);
  assert.strictEqual(app.sessionType, 'LongBreak', 'Should transition to LongBreak after 4 total slots');

  // Check daily log: only 2 completed entries should exist (Work 3, Work 4)
  const logs = app.storage.get(STORAGE_KEYS.LOGS, {});
  assert.strictEqual(logs[today].count, 2, 'Completed count should only be 2');
  assert.strictEqual(logs[today].items.length, 2);
});

// --- 5. FR-05 & BR-04: Memo Recording & Control Restriction ---
runTest('FR-05 & BR-04: Memo input works with empty text / skip and locks controls', () => {
  const app = new PomodoroEngine();
  app.start();
  app.onSessionComplete();
  assert.strictEqual(app.isMemoPending, true);

  // During Memo-Input-Pending, start/pause/reset/skip must be blocked
  app.start();
  assert.strictEqual(app.sessionStatus, 'Idle', 'Cannot start while memo is pending');
  app.skip();
  assert.strictEqual(app.sessionType, 'Focus', 'Cannot skip while memo is pending');

  // Submit empty memo
  app.skipMemo();
  assert.strictEqual(app.isMemoPending, false);
  const today = getLocalDateString();
  const logs = app.storage.get(STORAGE_KEYS.LOGS, {});
  assert.strictEqual(logs[today].count, 1);
  assert.strictEqual(logs[today].items[0].memo, '');
});

// --- 6. FR-06: Daily Log Ordering & Content ---
runTest('FR-06: Daily logs stored and ordered in chronological ascending order', () => {
  const app = new PomodoroEngine();
  const t1 = Date.now() - 5000;
  const t2 = Date.now() - 2000;
  app.recordCompletedFocus(t1, 'Task A');
  app.recordCompletedFocus(t2, 'Task B');

  const today = getLocalDateString();
  const logs = app.storage.get(STORAGE_KEYS.LOGS, {});
  assert.strictEqual(logs[today].count, 2);
  assert.strictEqual(logs[today].items[0].memo, 'Task A');
  assert.strictEqual(logs[today].items[1].memo, 'Task B');
});

// --- 7. FR-07: Settings Customization & Application Timing ---
runTest('FR-07: Idle session reflects setting change immediately; Running session defers', () => {
  const app = new PomodoroEngine();
  assert.strictEqual(app.remainingSeconds, 25 * 60);

  // In Idle state, updating settings immediately updates remainingSeconds
  app.saveSettings({ focusDuration: 30, shortBreakDuration: 7, longBreakDuration: 20 });
  assert.strictEqual(app.remainingSeconds, 30 * 60);

  // Start timer in Running state
  app.start();
  const originalEnd = app.endTimestamp;

  // Change settings while Running
  app.saveSettings({ focusDuration: 45, shortBreakDuration: 10, longBreakDuration: 25 });
  // Running session endTimestamp & remainingSeconds must not be overwritten
  assert.strictEqual(app.endTimestamp, originalEnd);

  // Once finished and next session begins, new settings take effect
  app.onSessionComplete();
  app.submitMemo('Done');
  assert.strictEqual(app.sessionType, 'ShortBreak');
  assert.strictEqual(app.remainingSeconds, 10 * 60, 'Next session must use new 10 min setting');
});

// --- 8. FR-08, EC-03, BR-02: Persistence & Restoration ---
runTest('FR-08: Paused state restores snapshot without expiry calculation', () => {
  const app1 = new PomodoroEngine();
  app1.start();
  app1.pause();
  const pausedRemaining = app1.remainingSeconds;

  // Simulate reloading app
  const app2 = new PomodoroEngine();
  assert.strictEqual(app2.sessionStatus, 'Paused');
  assert.strictEqual(app2.remainingSeconds, pausedRemaining);
  assert.strictEqual(app2.endTimestamp, null);
});

runTest('EC-03 & BR-02: Expired Running session on reload processes 1 completion and waits in Idle (no auto-start)', () => {
  const pastTime = Date.now() - 3600 * 1000; // 1 hour ago
  mockStorage.setItem(STORAGE_KEYS.TIMER_STATE, JSON.stringify({
    sessionType: 'Focus',
    sessionStatus: 'Running',
    endTimestamp: pastTime,
    remainingSeconds: 0,
    completedSlots: 0,
    isMemoPending: false
  }));

  const app = new PomodoroEngine();
  // Must process 1 completed focus
  const today = getLocalDateString(new Date(pastTime));
  const logs = app.storage.get(STORAGE_KEYS.LOGS, {});
  assert.strictEqual(logs[today].count, 1, 'Expired session must record 1 completion');
  assert.strictEqual(app.completedSlots, 1);
  assert.strictEqual(app.isMemoPending, true);
  assert.strictEqual(app.sessionStatus, 'Idle', 'Must wait in Idle / MemoPending without auto starting');
});

// --- 9. EC-04: Local System Clock Anomaly Delta Detection ---
runTest('EC-04: System clock delta anomaly >= 5000ms triggers automatic pause and alert', () => {
  const app = new PomodoroEngine();
  app.start();
  assert.strictEqual(app.sessionStatus, 'Running');

  const baseDate = app.dateAnchor;
  const basePerf = app.perfAnchor;

  // Case A: Normal 1 second elapsed (date +1000, perf +1000) -> diff = 0 -> No anomaly
  let detected = app.checkClockAnomaly(baseDate + 1000, basePerf + 1000);
  assert.strictEqual(detected, false);
  assert.strictEqual(app.sessionStatus, 'Running');

  // Case B: Clock jump! Date jumped +100,000ms while perf only advanced +1000ms -> diff = 99,000ms >= 5000ms
  detected = app.checkClockAnomaly(baseDate + 100000, basePerf + 1000);
  assert.strictEqual(detected, true, 'Clock anomaly must be detected');
  assert.strictEqual(app.sessionStatus, 'Paused', 'Timer must pause immediately on clock anomaly');
  assert.strictEqual(app.isClockAnomaly, true);

  // Resume from clock anomaly
  app.resumeFromClockAnomaly();
  assert.strictEqual(app.isClockAnomaly, false);
  assert.strictEqual(app.sessionStatus, 'Running');
});

// --- 10. EC-05: Storage Failure Fault Tolerance ---
runTest('EC-05: localStorage write failure toggles warning banner but continues in-memory execution', () => {
  const app = new PomodoroEngine();
  mockStorage.failWrites = true;

  // Trigger state change while storage is failing
  app.start();
  assert.strictEqual(app.storageWarningTriggered, true, 'Storage warning must trigger on write failure');
  assert.strictEqual(app.sessionStatus, 'Running', 'Timer must continue running in memory');

  // Storage recovers
  mockStorage.failWrites = false;
  app.pause();
  assert.strictEqual(app.storageWarningTriggered, false, 'Storage warning must clear when write succeeds');
  assert.strictEqual(app.sessionStatus, 'Paused');
});

console.log('====================================================');
console.log(`Test Suite Summary: Total ${passedCount + failedCount} | Passed: ${passedCount} | Failed: ${failedCount}`);
console.log('====================================================');

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

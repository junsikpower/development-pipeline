/**
 * Pomodoro Timer PRD v4 Automated Test Suite
 * Covers FR-01 ~ FR-08, BR-01 ~ BR-04, EC-01 ~ EC-05, and Acceptance Criteria
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock browser environment
class MockLocalStorage {
  constructor() {
    this.store = {};
    this.failWrites = false;
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    if (this.failWrites) {
      throw new Error('QuotaExceededError');
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

global.localStorage = new MockLocalStorage();

// Mock AudioService & NotificationService
class MockAudioService {
  constructor() {
    this.playedFocus = 0;
    this.playedBreak = 0;
    this.shouldFail = false;
  }
  init() {}
  unlock() {}
  playFocusComplete() {
    if (this.shouldFail) return Promise.reject(new Error('Audio playback failed'));
    this.playedFocus++;
    return Promise.resolve();
  }
  playBreakComplete() {
    if (this.shouldFail) return Promise.reject(new Error('Audio playback failed'));
    this.playedBreak++;
    return Promise.resolve();
  }
}

class MockNotificationService {
  constructor(audio) {
    this.audio = audio;
    this.permission = 'default';
    this.flashedTitle = null;
  }
  notifySessionEnd(type) {
    if (type === 'focus') this.audio.playFocusComplete().catch(() => this.flashTabTitle('집중 세션 종료!'));
    else this.audio.playBreakComplete().catch(() => this.flashTabTitle('휴식 세션 종료!'));
  }
  flashTabTitle(msg) {
    this.flashedTitle = msg;
  }
  stopFlashTabTitle() {
    this.flashedTitle = null;
  }
}

// Load exported classes from index.html
const indexHtmlContent = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// Extract javascript code
const scriptMatch = indexHtmlContent.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error('Could not find script block in index.html');
}

// Evaluate code in test sandbox
const sandbox = {
  window: {},
  document: {
    title: '뽀모도로 타이머',
    addEventListener: () => {},
    documentElement: { style: { setProperty: () => {} } }
  },
  localStorage: global.localStorage,
  performance: { now: () => Date.now() },
  Notification: { permission: 'default' },
  module: { exports: {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval
};

const scriptFn = new Function('window', 'document', 'localStorage', 'performance', 'Notification', 'module', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', scriptMatch[1]);
scriptFn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.performance, sandbox.Notification, sandbox.module, setTimeout, clearTimeout, setInterval, clearInterval);

const { StorageService, PomodoroEngine } = sandbox.module.exports;

// Test Suite Runner
let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  try {
    global.localStorage.clear();
    global.localStorage.failWrites = false;
    fn();
    console.log(`[PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${testName}:`, err.message);
    console.error(err.stack);
    failedTests++;
  }
}

console.log('--- Starting Pomodoro Timer PRD v4 Verification Tests ---\n');

// 1. FR-01, BR-03: Timer Start, Pause, Reset and Cycle Slot Preservation
runTest('FR-01 & BR-03: Timer Start, Pause, Reset & Slot Preservation', () => {
  const storage = new StorageService();
  const audio = new MockAudioService();
  const notifier = new MockNotificationService(audio);
  const engine = new PomodoroEngine(storage, notifier, audio);
  engine.init();

  assert.strictEqual(engine.sessionType, 'focus');
  assert.strictEqual(engine.sessionStatus, 'idle');
  assert.strictEqual(engine.remainingSeconds, 25 * 60);
  assert.strictEqual(engine.slotsUsed, 0);

  // Start
  engine.start();
  assert.strictEqual(engine.sessionStatus, 'running');
  assert(engine.endTimestamp > Date.now());

  // Pause
  engine.pause();
  assert.strictEqual(engine.sessionStatus, 'paused');
  assert.strictEqual(engine.endTimestamp, null);
  assert(engine.remainingSeconds > 0);

  // Simulate 3 slots used before reset
  engine.slotsUsed = 3;
  engine.reset();
  assert.strictEqual(engine.sessionStatus, 'idle');
  assert.strictEqual(engine.remainingSeconds, 25 * 60);
  // BR-03: slotsUsed must be preserved after reset
  assert.strictEqual(engine.slotsUsed, 3, 'slotsUsed should remain 3 after reset');
});

// 2. FR-03, BR-01: Full 4-cycle Flow and Automatic Transition
runTest('FR-03 & BR-01: 4 Focus Cycle Progression to Long Break', () => {
  const storage = new StorageService();
  const audio = new MockAudioService();
  const notifier = new MockNotificationService(audio);
  let memoRequested = false;

  const engine = new PomodoroEngine(storage, notifier, audio, null, () => {
    memoRequested = true;
  });
  engine.init();

  // Cycle 1: Focus 1
  engine.start();
  engine.handleSessionComplete();
  assert.strictEqual(engine.sessionStatus, 'memoPending');
  assert.strictEqual(memoRequested, true);
  assert.strictEqual(engine.slotsUsed, 1);
  assert.strictEqual(audio.playedFocus, 1);

  // Submit memo -> Short Break 1 starts automatically
  memoRequested = false;
  engine.submitMemoAndProceed('Task 1 completed');
  assert.strictEqual(engine.sessionType, 'shortBreak');
  assert.strictEqual(engine.sessionStatus, 'running');

  // Short Break 1 completes -> Focus 2 starts automatically without memo
  engine.handleSessionComplete();
  assert.strictEqual(engine.sessionType, 'focus');
  assert.strictEqual(engine.sessionStatus, 'running');
  assert.strictEqual(audio.playedBreak, 1);

  // Cycle 2: Focus 2 complete -> memo -> Short Break 2
  engine.handleSessionComplete();
  assert.strictEqual(engine.slotsUsed, 2);
  engine.skipMemoAndProceed();
  assert.strictEqual(engine.sessionType, 'shortBreak');
  assert.strictEqual(engine.sessionStatus, 'running');

  // Short Break 2 complete -> Focus 3
  engine.handleSessionComplete();
  assert.strictEqual(engine.sessionType, 'focus');
  assert.strictEqual(engine.sessionStatus, 'running');

  // Cycle 3: Focus 3 complete -> memo -> Short Break 3
  engine.handleSessionComplete();
  assert.strictEqual(engine.slotsUsed, 3);
  engine.submitMemoAndProceed('Task 3 completed');
  assert.strictEqual(engine.sessionType, 'shortBreak');

  // Short Break 3 complete -> Focus 4
  engine.handleSessionComplete();
  assert.strictEqual(engine.sessionType, 'focus');
  assert.strictEqual(engine.sessionStatus, 'running');

  // Cycle 4: Focus 4 complete -> memo -> Long Break
  engine.handleSessionComplete();
  assert.strictEqual(engine.slotsUsed, 4);
  engine.submitMemoAndProceed('Task 4 completed');
  assert.strictEqual(engine.sessionType, 'longBreak', '4th Focus must transition to Long Break');
  assert.strictEqual(engine.sessionStatus, 'running');
  assert.strictEqual(engine.slotsUsed, 0, 'Cycle should reset to 0 slots for next round');

  // Long Break complete -> Focus 1 (cycle restarts)
  engine.handleSessionComplete();
  assert.strictEqual(engine.sessionType, 'focus');
  assert.strictEqual(engine.sessionStatus, 'running');
  assert.strictEqual(engine.slotsUsed, 0);
});

// 3. FR-04: Skip logic and slot consumption
runTest('FR-04: Skip functionality does not increment completedCount but consumes slot', () => {
  const storage = new StorageService();
  const audio = new MockAudioService();
  const notifier = new MockNotificationService(audio);
  const engine = new PomodoroEngine(storage, notifier, audio);
  engine.init();

  // Skip 2 Focus sessions
  engine.start();
  engine.skip(); // Focus 1 skipped -> Short Break
  assert.strictEqual(engine.slotsUsed, 1);
  assert.strictEqual(engine.sessionType, 'shortBreak');

  engine.skip(); // Short Break skipped -> Focus 2
  assert.strictEqual(engine.sessionType, 'focus');

  engine.skip(); // Focus 2 skipped -> Short Break
  assert.strictEqual(engine.slotsUsed, 2);
  assert.strictEqual(engine.sessionType, 'shortBreak');

  engine.skip(); // Short Break skipped -> Focus 3
  assert.strictEqual(engine.sessionType, 'focus');

  // Complete Focus 3 normally
  engine.handleSessionComplete();
  engine.submitMemoAndProceed('Focus 3 finished');
  assert.strictEqual(engine.slotsUsed, 3);
  assert.strictEqual(engine.sessionType, 'shortBreak');

  // Complete Short Break
  engine.handleSessionComplete();
  assert.strictEqual(engine.sessionType, 'focus');

  // Complete Focus 4 normally
  engine.handleSessionComplete();
  engine.submitMemoAndProceed('Focus 4 finished');
  assert.strictEqual(engine.sessionType, 'longBreak', 'Total 4 slots consumed should lead to Long Break');

  // Verify daily logs: Only 2 focus sessions were completed normally
  const logs = storage.getLogs();
  const todayKey = engine.getLocalDateString(Date.now());
  assert.strictEqual(logs[todayKey].completedCount, 2, 'Completed count must be 2');
  assert.strictEqual(logs[todayKey].memos.length, 2);
});

// 4. FR-05 & FR-06: Work memo, empty memo handling, and daily log order
runTest('FR-05 & FR-06: Work memos and chronological ascending daily logs', () => {
  const storage = new StorageService();
  const audio = new MockAudioService();
  const notifier = new MockNotificationService(audio);
  const engine = new PomodoroEngine(storage, notifier, audio);
  engine.init();

  const baseTime = new Date('2026-08-20T10:00:00Z').getTime();

  // Record 3 memos with varying timestamps and content
  engine.recordFocusCompletion(baseTime + 10000, 'Second task');
  engine.recordFocusCompletion(baseTime, 'First task');
  engine.recordFocusCompletion(baseTime + 20000, ''); // empty memo

  const dateKey = engine.getLocalDateString(baseTime);
  const dayLog = storage.getLogs()[dateKey];

  assert.strictEqual(dayLog.completedCount, 3);
  assert.strictEqual(dayLog.memos.length, 3);
  // Verify ascending chronological order
  assert.strictEqual(dayLog.memos[0].text, 'First task');
  assert.strictEqual(dayLog.memos[1].text, 'Second task');
  assert.strictEqual(dayLog.memos[2].text, '');
});

// 5. FR-07: Settings duration customization and validation
runTest('FR-07: Custom settings validation and Idle vs Running/Paused application', () => {
  const storage = new StorageService();
  const audio = new MockAudioService();
  const notifier = new MockNotificationService(audio);
  const engine = new PomodoroEngine(storage, notifier, audio);
  engine.init();

  // Invalid values validation
  assert.strictEqual(engine.updateSettings({ focusMinutes: 0, shortBreakMinutes: 5, longBreakMinutes: 15 }), false);
  assert.strictEqual(engine.updateSettings({ focusMinutes: 181, shortBreakMinutes: 5, longBreakMinutes: 15 }), false);
  assert.strictEqual(engine.updateSettings({ focusMinutes: 25.5, shortBreakMinutes: 5, longBreakMinutes: 15 }), false);
  assert.strictEqual(engine.updateSettings({ focusMinutes: 'abc', shortBreakMinutes: 5, longBreakMinutes: 15 }), false);

  // Valid change while Idle: Immediately updates remainingSeconds
  const successIdle = engine.updateSettings({ focusMinutes: 30, shortBreakMinutes: 10, longBreakMinutes: 20 });
  assert.strictEqual(successIdle, true);
  assert.strictEqual(engine.settings.focusMinutes, 30);
  assert.strictEqual(engine.remainingSeconds, 30 * 60, 'Idle session remainingSeconds must update immediately');

  // Change while Running: Does NOT change current session's remainingSeconds/allocatedTotalSeconds
  engine.start();
  const successRunning = engine.updateSettings({ focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20 });
  assert.strictEqual(successRunning, true);
  assert.strictEqual(engine.allocatedTotalSeconds, 30 * 60, 'Current running session duration should not change');
});

// 6. FR-08, BR-02, EC-03: Persistence & Page Reload / Reconnect Restoration
runTest('FR-08, BR-02, EC-03: Paused restoration snapshot & Running expired single session idle restoration', () => {
  const storage = new StorageService();

  // Case A: Paused state restoration (FR-08, EC-03)
  storage.saveTimerState({
    sessionType: 'focus',
    sessionStatus: 'paused',
    slotsUsed: 2,
    remainingSeconds: 750,
    allocatedTotalSeconds: 1500,
    endTimestamp: null
  });

  const audioA = new MockAudioService();
  const notifierA = new MockNotificationService(audioA);
  const engineA = new PomodoroEngine(storage, notifierA, audioA);
  engineA.init();

  assert.strictEqual(engineA.sessionType, 'focus');
  assert.strictEqual(engineA.sessionStatus, 'paused');
  assert.strictEqual(engineA.remainingSeconds, 750, 'Paused remaining seconds snapshot must be restored');
  assert.strictEqual(engineA.slotsUsed, 2);

  // Case B: Running state expired while offline (multi-session elapsed -> single completion + Idle wait BR-02, EC-03)
  const expiredEnd = Date.now() - 3600 * 1000; // expired 1 hour ago
  storage.saveTimerState({
    sessionType: 'focus',
    sessionStatus: 'running',
    slotsUsed: 0,
    remainingSeconds: 100,
    allocatedTotalSeconds: 1500,
    endTimestamp: expiredEnd
  });

  const audioB = new MockAudioService();
  const notifierB = new MockNotificationService(audioB);
  const engineB = new PomodoroEngine(storage, notifierB, audioB);
  engineB.init();

  // Focus was expired -> 1 completed logged, slotsUsed becomes 1, next is Short Break in IDLE state (BR-02)
  assert.strictEqual(engineB.sessionType, 'shortBreak');
  assert.strictEqual(engineB.sessionStatus, 'idle', 'Restored expired session must wait in Idle state (BR-02)');
  assert.strictEqual(engineB.slotsUsed, 1);

  const logsB = storage.getLogs();
  const expiredDateKey = engineB.getLocalDateString(expiredEnd);
  assert.strictEqual(logsB[expiredDateKey].completedCount, 1, 'Log must be attributed to original endTimestamp');
});

// 7. EC-04: System clock anomaly delta detection algorithm
runTest('EC-04: System clock drift delta comparison and auto pause', () => {
  const storage = new StorageService();
  const audio = new MockAudioService();
  const notifier = new MockNotificationService(audio);
  let clockAlertFired = false;

  const engine = new PomodoroEngine(storage, notifier, audio, null, null, () => {
    clockAlertFired = true;
  });
  engine.init();
  engine.start();

  // Normal tick (no drift)
  engine.tick();
  assert.strictEqual(engine.sessionStatus, 'running');
  assert.strictEqual(clockAlertFired, false);

  // Anomaly: System date jumped by 10 minutes, but perfAnchor remained small
  engine.dateAnchor = Date.now() - (10 * 60 * 1000); // 600,000ms delta
  engine.perfAnchor = Date.now(); // 0ms delta -> diff is ~600,000ms >= 5000ms threshold

  engine.tick();
  assert.strictEqual(engine.sessionStatus, 'paused', 'Engine must pause upon detecting clock drift');
  assert.strictEqual(clockAlertFired, true, 'Clock alert callback must be triggered');

  // Resume from alert
  engine.resumeFromClockAlert();
  assert.strictEqual(engine.sessionStatus, 'running');
});

// 8. EC-05: LocalStorage write failure detection and recovery
runTest('EC-05: LocalStorage write failure state and recovery', () => {
  let writeFailedNotified = null;
  const storage = new StorageService((failed) => {
    writeFailedNotified = failed;
  });

  // Normal save
  const s1 = storage.saveSettings({ focusMinutes: 25 });
  assert.strictEqual(s1, true);
  assert.strictEqual(storage.isWriteFailed, false);

  // Storage failure (QuotaExceeded)
  global.localStorage.failWrites = true;
  const s2 = storage.saveSettings({ focusMinutes: 30 });
  assert.strictEqual(s2, false);
  assert.strictEqual(storage.isWriteFailed, true);
  assert.strictEqual(writeFailedNotified, true);

  // Recovery
  global.localStorage.failWrites = false;
  const s3 = storage.saveSettings({ focusMinutes: 30 });
  assert.strictEqual(s3, true);
  assert.strictEqual(storage.isWriteFailed, false);
  assert.strictEqual(writeFailedNotified, false);
});

// 9. FR-02 & EC-01: Sound failure tab title fallback
runTest('FR-02 & EC-01: Sound failure falls back to tab title flash', async () => {
  const audio = new MockAudioService();
  audio.shouldFail = true; // simulate AudioContext rejection
  const notifier = new MockNotificationService(audio);

  notifier.notifySessionEnd('focus');
  // Wait for promise rejection handle
  await new Promise(r => setTimeout(r, 20));

  assert.strictEqual(notifier.flashedTitle, '집중 세션 종료!', 'Tab title must flash when audio fails');
});

console.log(`\n========================================`);
console.log(`Test Summary: Total ${passedTests + failedTests}, Passed: ${passedTests}, Failed: ${failedTests}`);
console.log(`========================================`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

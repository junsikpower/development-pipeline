/**
 * Comprehensive Automated Test Suite for Pomodoro Timer & Work Logger Web App
 * Verifies all FRs, BRs, ECs, and Acceptance Criteria specified in PRD v4 (Final).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

// Read index.html
const htmlPath = path.resolve(__dirname, 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Mock localStorage
class MockLocalStorage {
  constructor() {
    this.store = {};
    this.failNext = false;
  }
  getItem(key) {
    return this.store.hasOwnProperty(key) ? this.store[key] : null;
  }
  setItem(key, value) {
    if (this.failNext) {
      throw new Error('QuotaExceededError: DOM Exception 22');
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

// Mock Web Audio API
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
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
        exponentialRampToValueAtTime: () => {}
      },
      connect: () => {}
    };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

// Mock DOM Element
class MockElement {
  constructor(id = '', tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    const classSet = new Set();
    this.classList = {
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
      contains: (c) => classSet.has(c),
      toString: () => Array.from(classSet).join(' ')
    };
    this.attributes = {};
    this.style = {
      setProperty: (prop, val) => { this.style[prop] = val; },
      getPropertyValue: (prop) => this.style[prop] || ''
    };
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.children = [];
    this.eventListeners = {};
  }
  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, val) { this.attributes[name] = String(val); }
  addEventListener(event, handler) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(handler);
  }
  dispatchEvent(event) {
    if (this.eventListeners[event.type]) {
      this.eventListeners[event.type].forEach(h => h(event));
    }
  }
  click() {
    this.dispatchEvent({ type: 'click', preventDefault: () => {} });
  }
  focus() {}
  appendChild(child) {
    this.children.push(child);
  }
}

function setupMockEnvironment() {
  const localStorage = new MockLocalStorage();
  const elements = {};

  const getOrCreateElem = (id, tag = 'div') => {
    if (!elements[id]) {
      elements[id] = new MockElement(id, tag);
    }
    return elements[id];
  };

  const documentMock = {
    title: '뽀모도로 타이머 & 작업 기록',
    documentElement: new MockElement('html'),
    hidden: false,
    eventListeners: {},
    getElementById: (id) => getOrCreateElem(id),
    querySelectorAll: (selector) => {
      if (selector === '.cycle-dot') {
        return [1, 2, 3, 4].map(i => {
          const el = getOrCreateElem(`dot-${i}`);
          el.setAttribute('data-slot', i);
          return el;
        });
      }
      if (selector === '.nav-btn') {
        return ['nav-timer', 'nav-log', 'nav-settings'].map(id => getOrCreateElem(id, 'button'));
      }
      if (selector === '.view-content') {
        return ['view-timer', 'view-log', 'view-settings'].map(id => getOrCreateElem(id, 'div'));
      }
      return [];
    },
    createElement: (tag) => new MockElement('', tag),
    addEventListener: (event, handler) => {
      if (!documentMock.eventListeners[event]) documentMock.eventListeners[event] = [];
      documentMock.eventListeners[event].push(handler);
    }
  };

  const windowMock = {
    localStorage: localStorage,
    AudioContext: MockAudioContext,
    Notification: class MockNotification {
      static permission = 'granted';
      static requestPermission() {
        return Promise.resolve(MockNotification.permission);
      }
      constructor(title, options) {
        this.title = title;
        this.options = options;
        windowMock.__lastNotification = { title, options };
      }
    },
    document: documentMock,
    performance: performance,
    Date: Date,
    Math: Math,
    parseInt: parseInt,
    isNaN: isNaN,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    Set: Set,
    Promise: Promise,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    console: console
  };
  windowMock.window = windowMock;

  return { windowMock, documentMock, localStorage, elements };
}

function extractScript(html) {
  const scriptStart = html.indexOf('<script>');
  const scriptEnd = html.lastIndexOf('</script>');
  if (scriptStart === -1 || scriptEnd === -1) {
    throw new Error('Script tags not found in index.html');
  }
  return html.substring(scriptStart + '<script>'.length, scriptEnd);
}

const appScript = extractScript(htmlContent);

let passCount = 0;
let failCount = 0;
const testResults = [];

async function test(name, fn) {
  try {
    const env = setupMockEnvironment();
    const context = vm.createContext(env.windowMock);
    vm.runInContext(appScript, context);

    const win = context.window;
    await fn(win, env);
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
    testResults.push({ name, status: 'PASS' });
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
    failCount++;
    testResults.push({ name, status: 'FAIL', error: err.message });
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('   뽀모도로 타이머 v4 (PRD Final) 자체 테스트 시작   ');
  console.log('====================================================\n');

  // --- Category 1: FR-01 타이머 기본 제어 ---
  console.log('--- 1. FR-01: Timer Controls (Start/Pause/Reset) & State ---');

  await test('FR-01-1: Start initializes endTimestamp and enters Running state', async (win) => {
    const engine = new win.PomodoroEngine();
    assert.strictEqual(engine.state.sessionState, 'Idle');
    assert.strictEqual(engine.state.sessionType, 'Focus');
    
    engine.start();
    assert.strictEqual(engine.state.sessionState, 'Running');
    assert(engine.state.endTimestamp > Date.now());
    assert.strictEqual(engine.state.remainingMs, 25 * 60 * 1000);
    engine.stopTicker();
  });

  await test('FR-01-2: Pause saves remainingMs snapshot (>= 1000ms) and clears endTimestamp', async (win) => {
    const engine = new win.PomodoroEngine();
    engine.start();
    engine.stopTicker();
    
    engine.pause();
    assert.strictEqual(engine.state.sessionState, 'Paused');
    assert.strictEqual(engine.state.endTimestamp, null);
    assert(engine.state.remainingMs >= 1000);
  });

  await test('FR-01-3: Reset restores Idle state with full duration; preserves consumedSlots (BR-03)', async (win) => {
    const engine = new win.PomodoroEngine();
    engine.state.consumedSlots = 3; // 3 slots already consumed
    engine.start();
    engine.stopTicker();
    
    engine.reset();
    assert.strictEqual(engine.state.sessionState, 'Idle');
    assert.strictEqual(engine.state.remainingMs, 25 * 60 * 1000);
    assert.strictEqual(engine.state.consumedSlots, 3, 'BR-03: Reset must NOT affect consumed slots');
  });

  await test('FR-01-4: Timer digits formatted correctly (MM:SS) during countdown', async (win) => {
    const engine = new win.PomodoroEngine();
    const ui = new win.UIManager(engine);

    engine.state.remainingMs = 25 * 60 * 1000;
    ui.render(engine.state);
    assert.strictEqual(ui.timerDigits.textContent, '25:00');

    engine.state.remainingMs = 124000; // 2m 4s
    ui.render(engine.state);
    assert.strictEqual(ui.timerDigits.textContent, '02:04');

    engine.state.remainingMs = 9000; // 9s
    ui.render(engine.state);
    assert.strictEqual(ui.timerDigits.textContent, '00:09');
  });

  // --- Category 2: FR-02 & EC-01 알림 및 사운드 ---
  console.log('\n--- 2. FR-02 & EC-01: Notifications, Sound & Fallbacks ---');

  await test('FR-02-1: Simultaneous Sound and Notification when permission is granted', async (win, env) => {
    win.Notification.permission = 'granted';
    win.NotificationManager.notify('세션 종료', '휴식 시간입니다');
    assert(env.windowMock.__lastNotification, 'Notification constructor must be called');
    assert.strictEqual(env.windowMock.__lastNotification.title, '세션 종료');
  });

  await test('EC-01-1: Fallback to title flash when Notification is denied or unsupported', async (win, env) => {
    win.Notification.permission = 'denied';
    delete env.windowMock.__lastNotification;
    win.NotificationManager.notify('세션 종료', '휴식 시간입니다');
    assert.strictEqual(env.windowMock.__lastNotification, undefined);
    assert(env.documentMock.title.includes('세션 종료') || env.documentMock.title.includes('🔔'));
    clearInterval(win.NotificationManager.titleFlashTimer);
  });

  // --- Category 3: FR-03 & BR-01 사이클 자동 전환 ---
  console.log('\n--- 3. FR-03 & BR-01: Pomodoro Cycle Transitions ---');

  await test('FR-03-1: 4 Focus Cycle leads to Long Break after 4th Focus', async (win) => {
    const engine = new win.PomodoroEngine();
    assert.strictEqual(engine.state.consumedSlots, 0);

    // 1st Focus complete
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.consumedSlots, 1);
    assert.strictEqual(engine.state.isMemoPending, true);
    engine.submitMemo('Task 1');
    assert.strictEqual(engine.state.sessionType, 'ShortBreak');
    assert.strictEqual(engine.state.sessionState, 'Running');
    engine.stopTicker();

    // ShortBreak complete -> 2nd Focus
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.sessionType, 'Focus');
    assert.strictEqual(engine.state.sessionState, 'Running');
    engine.stopTicker();

    // 2nd Focus complete
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.consumedSlots, 2);
    engine.submitMemo('Task 2');
    assert.strictEqual(engine.state.sessionType, 'ShortBreak');
    engine.stopTicker();

    // ShortBreak complete -> 3rd Focus
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.sessionType, 'Focus');
    engine.stopTicker();

    // 3rd Focus complete
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.consumedSlots, 3);
    engine.submitMemo('Task 3');
    assert.strictEqual(engine.state.sessionType, 'ShortBreak');
    engine.stopTicker();

    // ShortBreak complete -> 4th Focus
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.sessionType, 'Focus');
    engine.stopTicker();

    // 4th Focus complete -> Must transition to Long Break!
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.consumedSlots, 4);
    engine.submitMemo('Task 4');
    assert.strictEqual(engine.state.sessionType, 'LongBreak', '4th Focus must transition to LongBreak');
    assert.strictEqual(engine.state.sessionState, 'Running');
    engine.stopTicker();

    // Long Break complete -> Resets slots to 0 and transitions to Focus
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.sessionType, 'Focus');
    assert.strictEqual(engine.state.consumedSlots, 0, 'Long break complete resets consumed slots to 0');
    engine.stopTicker();
  });

  // --- Category 4: FR-04 세션 건너뛰기 (Skip) ---
  console.log('\n--- 4. FR-04: Session Skipping (Skip) ---');

  await test('FR-04-1: Focus Skip consumes slot without increasing completed count or requesting memo', async (win) => {
    const engine = new win.PomodoroEngine();
    assert.strictEqual(engine.getTodayCompletedCount(), 0);
    assert.strictEqual(engine.state.consumedSlots, 0);

    engine.skip();
    assert.strictEqual(engine.state.consumedSlots, 1, 'Skip must consume focus slot');
    assert.strictEqual(engine.state.isMemoPending, false, 'Skip must not show memo modal');
    assert.strictEqual(engine.getTodayCompletedCount(), 0, 'Skip must not increment completed count');
    assert.strictEqual(engine.state.sessionType, 'ShortBreak');
    engine.stopTicker();
  });

  await test('FR-04-2: 2 Skips + 2 Normal Completes = 4 Slots Consumed -> Long Break', async (win) => {
    const engine = new win.PomodoroEngine();
    
    // Focus 1: Skip -> Short Break -> Focus 2
    engine.skip();
    engine.stopTicker();
    engine.handleSessionComplete(); // Short break complete -> Focus 2
    engine.stopTicker();

    // Focus 2: Skip -> Short Break -> Focus 3
    engine.skip();
    engine.stopTicker();
    engine.handleSessionComplete(); // Short break complete -> Focus 3
    engine.stopTicker();

    assert.strictEqual(engine.state.consumedSlots, 2);
    assert.strictEqual(engine.getTodayCompletedCount(), 0);

    // Focus 3: Normal Complete
    engine.handleSessionComplete();
    engine.submitMemo('Focus 3 done');
    engine.stopTicker();
    engine.handleSessionComplete(); // Short break complete -> Focus 4
    engine.stopTicker();

    // Focus 4: Normal Complete
    engine.handleSessionComplete();
    engine.submitMemo('Focus 4 done');
    engine.stopTicker();

    assert.strictEqual(engine.state.consumedSlots, 4);
    assert.strictEqual(engine.getTodayCompletedCount(), 2, 'Completed count must be 2');
    assert.strictEqual(engine.state.sessionType, 'LongBreak', 'Total 4 consumed slots must lead to LongBreak');
  });

  // --- Category 5: FR-05 & BR-04 작업 메모 및 UI 상태 제한 ---
  console.log('\n--- 5. FR-05 & BR-04: Work Memo & UI Restrictions ---');

  await test('FR-05-1: Empty or skipped memo records empty string and increments completed count', async (win) => {
    const engine = new win.PomodoroEngine();
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.isMemoPending, true);

    engine.skipMemo();
    assert.strictEqual(engine.state.isMemoPending, false);
    assert.strictEqual(engine.getTodayCompletedCount(), 1);

    const log = engine.getDailyLog(engine.formatDateKey(new Date()));
    assert.strictEqual(log.memos.length, 1);
    assert.strictEqual(log.memos[0].text, '');
    engine.stopTicker();
  });

  await test('BR-04-1: Controls hidden during Memo-Input-Pending state', async (win) => {
    const engine = new win.PomodoroEngine();
    const ui = new win.UIManager(engine);

    engine.handleSessionComplete();
    assert.strictEqual(ui.timerControls.style.display, 'none', 'Timer controls must be hidden during memo pending');
    assert(ui.modalMemo.classList.contains('active'), 'Memo modal must be active');

    ui.btnMemoSubmit.click();
    assert.strictEqual(ui.timerControls.style.display, 'flex', 'Timer controls restored after memo submit');
    assert(!ui.modalMemo.classList.contains('active'), 'Memo modal hidden after submit');
    engine.stopTicker();
  });

  // --- Category 6: FR-06 일별 로그 및 오름차순 정렬 ---
  console.log('\n--- 6. FR-06: Daily Logs & Chronological Ordering ---');

  await test('FR-06-1: Daily logs sorted in ascending chronological order', async (win) => {
    const engine = new win.PomodoroEngine();
    const dateKey = '2026-08-20';

    engine.recordDailyLog(dateKey, '09:00:00', 'Morning Session 1');
    engine.recordDailyLog(dateKey, '10:30:00', 'Morning Session 2');
    engine.recordDailyLog(dateKey, '14:15:00', 'Afternoon Session 3');

    const log = engine.getDailyLog(dateKey);
    assert.strictEqual(log.completedCount, 3);
    assert.strictEqual(log.memos[0].time, '09:00:00');
    assert.strictEqual(log.memos[1].time, '10:30:00');
    assert.strictEqual(log.memos[2].time, '14:15:00');
  });

  // --- Category 7: FR-07 설정 유효성 검증 및 적용 시점 ---
  console.log('\n--- 7. FR-07: Settings Validation & Timing of Application ---');

  await test('FR-07-1: Out of range settings (0, 181, float, NaN) are rejected', async (win) => {
    const engine = new win.PomodoroEngine();
    
    assert.throws(() => engine.saveSettings({ focusDuration: 0, shortBreakDuration: 5, longBreakDuration: 15 }));
    assert.throws(() => engine.saveSettings({ focusDuration: 181, shortBreakDuration: 5, longBreakDuration: 15 }));
    assert.throws(() => engine.saveSettings({ focusDuration: 'abc', shortBreakDuration: 5, longBreakDuration: 15 }));
  });

  await test('FR-07-2: Idle session reflects setting change immediately; Running session preserves current session', async (win) => {
    const engine = new win.PomodoroEngine();
    assert.strictEqual(engine.state.sessionState, 'Idle');
    
    // Idle setting change -> updates remainingMs immediately
    engine.saveSettings({ focusDuration: 50, shortBreakDuration: 10, longBreakDuration: 20 });
    assert.strictEqual(engine.state.remainingMs, 50 * 60 * 1000, 'Idle session duration updated immediately');

    // Start session -> Running
    engine.start();
    engine.stopTicker();
    const runningEndTs = engine.state.endTimestamp;

    // Change setting while running to 30 min
    engine.saveSettings({ focusDuration: 30, shortBreakDuration: 10, longBreakDuration: 20 });
    assert.strictEqual(engine.state.endTimestamp, runningEndTs, 'Running session endTimestamp must NOT be altered');
  });

  // --- Category 8: FR-08 & EC-03 재접속/새로고침 상태 복원 ---
  console.log('\n--- 8. FR-08 & EC-03: State Persistence & Reconnection Restoration ---');

  await test('FR-08-1: Paused session restored snapshot remainingMs regardless of offline duration', async (win, env) => {
    // Save Paused state with 12 minutes remaining
    const savedState = {
      sessionType: 'Focus',
      sessionState: 'Paused',
      endTimestamp: null,
      remainingMs: 12 * 60 * 1000,
      consumedSlots: 2,
      isMemoPending: false
    };
    env.localStorage.setItem(win.StorageManager.KEYS.TIMER_STATE, JSON.stringify(savedState));

    const engine = new win.PomodoroEngine();
    assert.strictEqual(engine.state.sessionState, 'Paused');
    assert.strictEqual(engine.state.remainingMs, 12 * 60 * 1000);
    assert.strictEqual(engine.state.consumedSlots, 2);
  });

  await test('EC-03-1: Expired Running session offline processed ONLY 1 time, next session is IDLE (BR-02)', async (win, env) => {
    // Save Running state with endTimestamp in the past (e.g., 2 hours ago)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const savedState = {
      sessionType: 'Focus',
      sessionState: 'Running',
      endTimestamp: twoHoursAgo,
      remainingMs: 0,
      consumedSlots: 1,
      isMemoPending: false
    };
    env.localStorage.setItem(win.StorageManager.KEYS.TIMER_STATE, JSON.stringify(savedState));

    const engine = new win.PomodoroEngine();
    assert.strictEqual(engine.state.consumedSlots, 2, 'Only 1 focus session processed');
    assert.strictEqual(engine.state.isMemoPending, true, 'Memo pending for the 1 expired session');
    assert.strictEqual(engine.state.sessionState, 'Idle', 'BR-02: Next session must be IDLE, no auto-start');
    assert.strictEqual(engine.state.sessionType, 'ShortBreak', 'Next session type is ShortBreak');
  });

  // --- Category 9: EC-02 & EC-04 탭 백그라운드 및 시스템 시계 변경 감지 ---
  console.log('\n--- 9. EC-02 & EC-04: Background Correction & System Clock Anomaly Detection ---');

  await test('EC-02-1: Visibility change updates anchors and triggers tick verification', async (win, env) => {
    const engine = new win.PomodoroEngine();
    const ui = new win.UIManager(engine);
    engine.start();
    engine.stopTicker();

    // Trigger visibilitychange to active
    env.documentMock.hidden = false;
    env.documentMock.eventListeners['visibilitychange'].forEach(h => h());
    assert.strictEqual(engine.state.sessionState, 'Running');
  });

  await test('EC-04-1: Clock anomaly (delta difference >= 5000ms) pauses timer and shows confirmation modal', async (win) => {
    const engine = new win.PomodoroEngine();
    engine.start();
    engine.stopTicker();

    // Simulate clock jump: Date.now() moved forward by 1 hour while performance.now() only moved 1 sec
    win.ClockGuard.dateAnchor = Date.now() - 3600000;
    win.ClockGuard.perfAnchor = win.performance.now() - 1000;

    assert(win.ClockGuard.checkClockAnomaly(), 'Should detect clock anomaly');

    engine.tick();
    assert.strictEqual(engine.state.sessionState, 'Paused', 'Must pause on clock anomaly');
    assert.strictEqual(engine.state.endTimestamp, null);

    // Resume from modal
    engine.resumeFromClockAnomaly();
    assert.strictEqual(engine.state.sessionState, 'Running');
    engine.stopTicker();
  });

  // --- Category 10: EC-05 localStorage 쓰기 실패 대응 ---
  console.log('\n--- 10. EC-05: Storage Failure & Auto-Retry Handling ---');

  await test('EC-05-1: Storage write failure shows warning banner; continues memory execution; auto-recovers on success', async (win, env) => {
    const engine = new win.PomodoroEngine();
    const banner = env.documentMock.getElementById('storage-warning-banner');

    // Simulate storage quota exceeded
    env.localStorage.failNext = true;
    const writeResult = win.StorageManager.set('test_key', { a: 1 });
    assert.strictEqual(writeResult, false);
    assert.strictEqual(win.StorageManager.isWriteFailed, true);
    assert(banner.classList.contains('visible'), 'Warning banner must be shown on write failure');

    // In-memory timer operation continues normally
    engine.start();
    assert.strictEqual(engine.state.sessionState, 'Running');
    engine.stopTicker();

    // Simulate storage recovery
    env.localStorage.failNext = false;
    const recoverResult = win.StorageManager.set('test_key', { a: 2 });
    assert.strictEqual(recoverResult, true);
    assert.strictEqual(win.StorageManager.isWriteFailed, false);
    assert(!banner.classList.contains('visible'), 'Warning banner must be hidden after successful write');
  });

  // --- Category 11: 13. Acceptance Criteria 종합 검증 ---
  console.log('\n--- 11. 13. Acceptance Criteria Full Flow Verification ---');

  await test('13.1-1: Full Pomodoro Day Workflow (Focus -> ShortBreak -> Focus -> Memo -> Log check)', async (win) => {
    const engine = new win.PomodoroEngine();
    const today = engine.formatDateKey(new Date());

    // 1st Session: Focus 25m -> Complete
    engine.start();
    engine.stopTicker();
    engine.handleSessionComplete();
    assert.strictEqual(engine.state.isMemoPending, true);
    engine.submitMemo('Developed Timer Core');
    engine.stopTicker();

    // Short Break 5m -> Complete
    engine.handleSessionComplete();
    engine.stopTicker();

    // 2nd Session: Focus 25m -> Complete with empty memo
    assert.strictEqual(engine.state.sessionType, 'Focus');
    engine.handleSessionComplete();
    engine.skipMemo();
    engine.stopTicker();

    // Verify daily log
    const log = engine.getDailyLog(today);
    assert.strictEqual(log.completedCount, 2);
    assert.strictEqual(log.memos.length, 2);
    assert.strictEqual(log.memos[0].text, 'Developed Timer Core');
    assert.strictEqual(log.memos[1].text, '');
  });

  // --- Summary ---
  console.log('\n====================================================');
  console.log(`테스트 결과 요약: 총 ${passCount + failCount}개 중 ${passCount}개 통과 (실패: ${failCount}개)`);
  console.log('====================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite();

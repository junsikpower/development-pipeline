/**
 * Comprehensive Self-Test Suite for Pomodoro Timer Webapp (PRD v4)
 * Pure Node.js implementation without external dependencies.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const errors = [];

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message}`);
    errors.push(message);
  }
}

function assertEqual(actual, expected, message) {
  totalTests++;
  if (actual === expected) {
    passedTests++;
    console.log(`  ✓ PASS: ${message} (Got: ${JSON.stringify(actual)})`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message} (Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)})`);
    errors.push(`${message} | Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
  }
}

// Minimal DOM Element Mock
class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (...cls) => { cls.forEach(c => this.classList._classes.add(c)); this.className = Array.from(this.classList._classes).join(' '); },
      remove: (...cls) => { cls.forEach(c => this.classList._classes.delete(c)); this.className = Array.from(this.classList._classes).join(' '); },
      contains: (c) => this.classList._classes.has(c),
      toggle: (c) => { if (this.classList.contains(c)) this.classList.remove(c); else this.classList.add(c); }
    };
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.children = [];
    this.attributes = {};
    this._listeners = {};
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }

  addEventListener(event, handler, options) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    }
  }

  dispatchEvent(eventObj) {
    const handlers = this._listeners[eventObj.type] || [];
    handlers.forEach(h => h(eventObj));
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  change() {
    this.dispatchEvent({ type: 'change', target: this });
  }

  focus() {}

  appendChild(child) {
    this.children.push(child);
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) results.push(this);
    }
    this.children.forEach(c => {
      if (c.querySelectorAll) {
        results.push(...c.querySelectorAll(selector));
      }
    });
    return results;
  }
}

// Create Test Instance
function createTestInstance(initialLocalStorage = {}, shouldStorageFail = false) {
  const elements = {};
  const elementIds = [
    'storageErrorBanner', 'clockWarningBanner', 'bannerResumeBtn', 'clockModal', 'modalResumeBtn',
    'sessionBadge', 'cycleLabel', 'timerTime', 'timerStatusText', 'timerControls', 'toggleBtn',
    'toggleBtnText', 'resetBtn', 'skipBtn', 'memoCard', 'memoInput', 'memoSubmitBtn', 'memoSkipBtn',
    'logDatePicker', 'logCompletedCount', 'logList', 'logEmptyMsg', 'focusDurationInput',
    'shortBreakDurationInput', 'longBreakDurationInput', 'focusError', 'shortBreakError',
    'longBreakError', 'saveSettingsBtn', 'saveSuccessMsg'
  ];

  elementIds.forEach(id => {
    elements[id] = new MockElement('div', id);
  });

  // Setup cycleDots container
  const cycleDotsContainer = new MockElement('div', 'cycleDots');
  for (let i = 1; i <= 4; i++) {
    const dot = new MockElement('div', '');
    dot.setAttribute('data-slot', String(i));
    dot.classList.add('cycle-dot');
    cycleDotsContainer.appendChild(dot);
  }
  elements['cycleDots'] = cycleDotsContainer;

  // Tabs
  const navTabs = [
    new MockElement('button', ''),
    new MockElement('button', ''),
    new MockElement('button', '')
  ];
  navTabs[0].setAttribute('data-tab', 'timerTab');
  navTabs[0].classList.add('nav-tab', 'active');
  navTabs[1].setAttribute('data-tab', 'logTab');
  navTabs[1].classList.add('nav-tab');
  navTabs[2].setAttribute('data-tab', 'settingsTab');
  navTabs[2].classList.add('nav-tab');

  const tabContents = [
    new MockElement('div', 'timerTab'),
    new MockElement('div', 'logTab'),
    new MockElement('div', 'settingsTab')
  ];
  tabContents[0].classList.add('tab-content', 'active');
  tabContents[1].classList.add('tab-content');
  tabContents[2].classList.add('tab-content');

  // LocalStorage mock
  const storageMap = { ...initialLocalStorage };
  let storageFailFlag = shouldStorageFail;

  const mockLocalStorage = {
    getItem: (key) => storageMap[key] || null,
    setItem: (key, val) => {
      if (storageFailFlag) {
        throw new Error('QuotaExceededError');
      }
      storageMap[key] = String(val);
    },
    removeItem: (key) => { delete storageMap[key]; },
    clear: () => { Object.keys(storageMap).forEach(k => delete storageMap[k]); },
    _setFail: (fail) => { storageFailFlag = fail; },
    _getData: () => storageMap
  };

  // Mock Document
  const mockDocument = {
    title: '뽀모도로 타이머',
    readyState: 'complete',
    visibilityState: 'visible',
    getElementById: (id) => elements[id] || (tabContents.find(t => t.id === id)) || null,
    querySelectorAll: (selector) => {
      if (selector === '.nav-tab') return navTabs;
      if (selector === '.tab-content') return tabContents;
      if (selector === '.cycle-dot') return cycleDotsContainer.querySelectorAll('.cycle-dot');
      return [];
    },
    createElement: (tag) => new MockElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  // Performance mock
  let perfNow = 1000;
  const mockPerformance = {
    now: () => perfNow,
    _advance: (ms) => { perfNow += ms; }
  };

  // Notification mock
  let notificationInstances = [];
  class MockNotification {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      notificationInstances.push(this);
    }
  }
  MockNotification.permission = 'granted';
  MockNotification.requestPermission = () => Promise.resolve('granted');

  // AudioContext mock
  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    resume() { return Promise.resolve(); }
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

  // Sandbox Context
  const sandbox = {
    document: mockDocument,
    window: {
      AudioContext: MockAudioContext,
      webkitAudioContext: MockAudioContext,
      Notification: MockNotification,
      performance: mockPerformance,
      localStorage: mockLocalStorage,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    localStorage: mockLocalStorage,
    Notification: MockNotification,
    performance: mockPerformance,
    AudioContext: MockAudioContext,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    console: console,
    Date: Date
  };

  sandbox.window.document = mockDocument;
  sandbox.window.window = sandbox.window;

  // Extract JS from index.html
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('No script tag found in index.html');
  const scriptContent = scriptMatch[1];

  const context = vm.createContext(sandbox);
  vm.runInContext(scriptContent, context);

  return {
    window: sandbox.window,
    document: mockDocument,
    elements,
    localStorage: mockLocalStorage,
    performance: mockPerformance,
    internal: sandbox.window.__POMODORO_INTERNAL__,
    notifications: notificationInstances
  };
}

// ==========================================
// Test Suites
// ==========================================

function test1_InitialState() {
  console.log('\n--- [Test 1] 초기 상태 및 UI 초기화 검증 (FR-01, FR-07) ---');
  const env = createTestInstance();
  const state = env.internal.getTimerState();
  const settings = env.internal.getSettings();

  assertEqual(state.sessionType, 'focus', '초기 세션 타입은 Focus');
  assertEqual(state.sessionState, 'idle', '초기 세션 상태는 Idle');
  assertEqual(state.remainingSeconds, 25 * 60, '초기 남은 시간은 25분 (1500초)');
  assertEqual(state.focusSlotsConsumed, 0, '초기 소모 슬롯은 0');
  assertEqual(settings.focusDuration, 25, '기본 집중 시간은 25분');
  assertEqual(settings.shortBreakDuration, 5, '기본 짧은 휴식 시간은 5분');
  assertEqual(settings.longBreakDuration, 15, '기본 긴 휴식 시간은 15분');
  assertEqual(env.elements.timerTime.textContent, '25:00', '화면 타이머 25:00 표시');
}

function test2_StartPauseResumeReset() {
  console.log('\n--- [Test 2] 타이머 시작, 일시정지, 재개, 리셋 검증 (FR-01, BR-03) ---');
  const env = createTestInstance();

  // 1. Start
  env.elements.toggleBtn.click();
  let state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'running', '시작 버튼 클릭 시 Running 상태 전환');
  assert(state.endTimestamp > Date.now(), 'endTimestamp가 현재 시각 이후로 설정됨');

  // 2. Pause
  env.elements.toggleBtn.click();
  state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'paused', '일시정지 버튼 클릭 시 Paused 상태 전환');
  assertEqual(state.endTimestamp, null, 'Paused 상태에서는 endTimestamp가 null');
  assert(state.remainingSeconds > 0, '남은 시간 스냅샷이 양수로 보존됨');

  // 3. Resume
  env.elements.toggleBtn.click();
  state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'running', '계속하기 버튼 클릭 시 Running 상태 복귀');

  // 4. Reset
  env.elements.resetBtn.click();
  state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'idle', '리셋 클릭 시 Idle 상태 전환');
  assertEqual(state.remainingSeconds, 25 * 60, '리셋 시 남은 시간이 설정된 길이(25분)로 복원');
  assertEqual(env.elements.timerTime.textContent, '25:00', '화면 타이머 25:00 표시');
}

function test3_ResetSlotIndependence() {
  console.log('\n--- [Test 3] 리셋과 Focus 슬롯 소모 수의 독립성 검증 (BR-03, FR-01) ---');
  const env = createTestInstance();

  // 슬롯 3개 소모 상태 설정
  const state = env.internal.getTimerState();
  state.focusSlotsConsumed = 3;
  state.sessionType = 'focus';
  state.sessionState = 'running';
  state.remainingSeconds = 500;

  // 리셋 수행
  env.elements.resetBtn.click();

  assertEqual(state.sessionState, 'idle', '리셋 후 Idle 상태');
  assertEqual(state.remainingSeconds, 25 * 60, '타이머 시간만 25분으로 리셋');
  assertEqual(state.focusSlotsConsumed, 3, 'BR-03: 슬롯 소모 카운트는 여전히 3으로 유지됨');
}

function test4_FullPomodoroCycle() {
  console.log('\n--- [Test 4] 뽀모도로 전체 사이클 자동 전환 검증 (FR-03, BR-01, FR-05) ---');
  const env = createTestInstance();

  // Focus 1 완료 -> Memo-Input-Pending -> Memo Submit -> Short Break
  env.internal.handleSessionCompletion();
  let state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'memoPending', 'Focus 1 완료 시 Memo-Input-Pending 진입');
  assertEqual(state.focusSlotsConsumed, 1, '슬롯 소모 1로 증가');
  
  // Memo 제출
  env.internal.submitMemo('1회차 집중 완료');
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'shortBreak', '1회차 Focus 후 Short Break로 전환');
  assertEqual(state.sessionState, 'running', '실시간 자동 시작(Running)');

  // Short Break 완료 -> Focus 2
  env.internal.handleSessionCompletion();
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'focus', 'Short Break 완료 후 Focus 2 전환');
  assertEqual(state.sessionState, 'running', 'Focus 2 자동 시작');

  // Focus 2 완료 -> Memo 제출 -> Short Break
  env.internal.handleSessionCompletion();
  env.internal.submitMemo('2회차');
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'shortBreak', '2회차 Focus 후 Short Break');
  assertEqual(state.focusSlotsConsumed, 2, '슬롯 소모 2');

  // Short Break 완료 -> Focus 3
  env.internal.handleSessionCompletion();
  assertEqual(env.internal.getTimerState().sessionType, 'focus', 'Focus 3 전환');

  // Focus 3 완료 -> Memo 제출 -> Short Break
  env.internal.handleSessionCompletion();
  env.internal.submitMemo('3회차');
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'shortBreak', '3회차 Focus 후 Short Break');
  assertEqual(state.focusSlotsConsumed, 3, '슬롯 소모 3');

  // Short Break 완료 -> Focus 4
  env.internal.handleSessionCompletion();
  assertEqual(env.internal.getTimerState().sessionType, 'focus', 'Focus 4 전환');

  // Focus 4 완료 -> Memo 제출 -> Long Break (4번째 슬롯 소모)
  env.internal.handleSessionCompletion();
  env.internal.submitMemo('4회차 완료');
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'longBreak', '4번째 Focus 완료 후 Long Break로 전환');
  assertEqual(state.remainingSeconds, 15 * 60, 'Long Break 시간은 15분');

  // Long Break 완료 -> Focus 1 (새 사이클)
  env.internal.handleSessionCompletion();
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'focus', 'Long Break 완료 후 새로운 사이클의 Focus 1 시작');
  assertEqual(state.focusSlotsConsumed, 0, '사이클 초기화로 슬롯 소모 0');
}

function test5_SkipTimer() {
  console.log('\n--- [Test 5] 세션 건너뛰기(Skip) 검증 (FR-04, BR-01) ---');
  const env = createTestInstance();

  // Focus 1 시작 후 스킵
  env.elements.skipBtn.click();
  let state = env.internal.getTimerState();
  let logs = env.internal.getLogs();
  
  assertEqual(state.sessionType, 'shortBreak', 'Focus 1 스킵 후 Short Break로 전환');
  assertEqual(state.focusSlotsConsumed, 1, '스킵해도 슬롯은 소모됨');
  
  // 오늘 날짜 로그에 완료 카운트가 0인지 확인
  const today = new Date().toISOString().slice(0, 10);
  const logToday = logs[today] || { completedCount: 0 };
  assertEqual(logToday.completedCount, 0, 'Focus 스킵 시 완료 카운트 증가하지 않음');

  // Short Break 스킵 -> Focus 2
  env.elements.skipBtn.click();
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'focus', 'Short Break 스킵 후 Focus 2');

  // Focus 2 스킵 -> Short Break
  env.elements.skipBtn.click();
  assertEqual(env.internal.getTimerState().focusSlotsConsumed, 2, '슬롯 소모 2');

  // Short Break 스킵 -> Focus 3
  env.elements.skipBtn.click();

  // Focus 3 정상 완료
  env.internal.handleSessionCompletion();
  env.internal.submitMemo('Focus 3 완료');

  // Short Break 스킵 -> Focus 4
  env.elements.skipBtn.click();

  // Focus 4 정상 완료 -> Long Break (2스킵 + 2완료 = 총 4슬롯)
  env.internal.handleSessionCompletion();
  env.internal.submitMemo('Focus 4 완료');

  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'longBreak', '총 4슬롯 소모되어 Long Break 도달');

  logs = env.internal.getLogs();
  assertEqual(logs[today].completedCount, 2, '완료 카운트는 정상 완료한 2회만 기록');

  // Long Break 스킵 -> Focus 1 및 사이클 리셋
  env.elements.skipBtn.click();
  state = env.internal.getTimerState();
  assertEqual(state.sessionType, 'focus', 'Long Break 스킵 후 Focus 1');
  assertEqual(state.focusSlotsConsumed, 0, 'Long Break 스킵 시 슬롯 소모 0으로 초기화');
}

function getLocalTestDateStr(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function test6_MemoAndDailyLogs() {
  console.log('\n--- [Test 6] 작업 메모 및 일별 로그 검증 (FR-05, FR-06) ---');
  const env = createTestInstance();
  const today = getLocalTestDateStr();

  // 1. Focus 1 완료 후 빈 값 제출
  env.internal.handleSessionCompletion();
  env.internal.submitMemo(''); // 빈 값 -> 다음 세션 Short Break로 전환

  let logs = env.internal.getLogs();
  assertEqual(logs[today].completedCount, 1, '빈 값 제출 시에도 완료 카운트 정상 증가');
  assertEqual(logs[today].memos[0].memo, '', '빈 메모는 빈 문자열로 저장');

  // 2. Short Break 완료 -> Focus 2로 전환
  env.internal.handleSessionCompletion();
  assertEqual(env.internal.getTimerState().sessionType, 'focus', 'Short Break 완료 후 Focus 2 전환');

  // 3. Focus 2 완료 후 메모 입력 제출
  env.internal.handleSessionCompletion();
  env.internal.submitMemo('두 번째 세션 작업 내용');

  logs = env.internal.getLogs();
  assertEqual(logs[today].completedCount, 2, '완료 카운트 2');
  assertEqual(logs[today].memos.length, 2, '메모 목록 2개');
  assertEqual(logs[today].memos[1].memo, '두 번째 세션 작업 내용', '메모 내용 정상 저장');
}

function test7_SettingsCustomization() {
  console.log('\n--- [Test 7] 설정 유효성 검증 및 적용 시점 검증 (FR-07) ---');
  const env = createTestInstance();

  // 1. 유효성 검증
  assertEqual(env.internal.validateDurationInput('0'), false, '0분 거부');
  assertEqual(env.internal.validateDurationInput('-5'), false, '음수 거부');
  assertEqual(env.internal.validateDurationInput('181'), false, '181분 거부');
  assertEqual(env.internal.validateDurationInput('25.5'), false, '소수 거부');
  assertEqual(env.internal.validateDurationInput('abc'), false, '비숫자 거부');
  assertEqual(env.internal.validateDurationInput('50'), true, '50분 허용');

  // 2. Idle 상태에서 설정 변경 -> 즉시 반영
  env.elements.focusDurationInput.value = '45';
  env.elements.shortBreakDurationInput.value = '10';
  env.elements.longBreakDurationInput.value = '20';
  env.elements.saveSettingsBtn.click();

  let state = env.internal.getTimerState();
  let settings = env.internal.getSettings();
  assertEqual(settings.focusDuration, 45, '집중 시간 45분으로 변경');
  assertEqual(state.remainingSeconds, 45 * 60, 'Idle 상태의 남은시간 즉시 45분으로 갱신');
  assertEqual(env.elements.timerTime.textContent, '45:00', '화면 표시 즉시 45:00으로 갱신');

  // 3. Running 상태에서 설정 변경 -> 기존 세션 유지 후 다음 세션부터 반영
  env.internal.startTimer();
  env.elements.focusDurationInput.value = '30';
  env.elements.saveSettingsBtn.click();

  state = env.internal.getTimerState();
  assert(state.remainingSeconds > 40 * 60, '현재 Running 세션은 45분 기준 유지');

  // Focus 완료 -> Short Break (10분)
  env.internal.handleSessionCompletion();
  env.internal.submitMemo('완료');
  state = env.internal.getTimerState();
  assertEqual(state.remainingSeconds, 10 * 60, 'Short Break는 설정된 10분 적용');

  // Short Break 완료 -> 다음 Focus는 새로 변경된 30분 적용
  env.internal.handleSessionCompletion();
  state = env.internal.getTimerState();
  assertEqual(state.remainingSeconds, 30 * 60, '다음 Focus 회차에는 30분 적용');
}

function test8_DataPersistenceAndRecovery() {
  console.log('\n--- [Test 8] 데이터 영속성 및 재접속/새로고침 복원 검증 (FR-08, EC-03, BR-02) ---');

  // Case A: Paused 상태에서 새로고침 -> 남은 시간 스냅샷 그대로 복원
  const pausedSavedState = {
    sessionType: 'focus',
    sessionState: 'paused',
    endTimestamp: null,
    remainingSeconds: 745,
    focusSlotsConsumed: 2,
    pendingMemoSession: null
  };
  const storageWithPaused = {
    pomodoro_timer_state: JSON.stringify(pausedSavedState),
    pomodoro_settings: JSON.stringify({ focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15 }),
    pomodoro_logs: JSON.stringify({})
  };

  const envPaused = createTestInstance(storageWithPaused);
  const recoveredPausedState = envPaused.internal.getTimerState();

  assertEqual(recoveredPausedState.sessionState, 'paused', 'Paused 상태 그대로 복원');
  assertEqual(recoveredPausedState.remainingSeconds, 745, '남은 시간 스냅샷 745초 그대로 복원');
  assertEqual(recoveredPausedState.focusSlotsConsumed, 2, '소모 슬롯 2 복원');

  // Case B: Running 상태에서 오프라인 중 만료된 채 재접속 -> 1회만 종료 처리 + 다음 세션 Idle 대기 (BR-02)
  const pastEndTime = Date.now() - 3600 * 1000; // 1시간 전 만료
  const runningExpiredSavedState = {
    sessionType: 'focus',
    sessionState: 'running',
    endTimestamp: pastEndTime,
    remainingSeconds: 0,
    focusSlotsConsumed: 1,
    pendingMemoSession: null
  };
  const storageWithRunningExpired = {
    pomodoro_timer_state: JSON.stringify(runningExpiredSavedState),
    pomodoro_settings: JSON.stringify({ focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15 }),
    pomodoro_logs: JSON.stringify({})
  };

  const envExpired = createTestInstance(storageWithRunningExpired);
  const recoveredExpiredState = envExpired.internal.getTimerState();
  const recoveredLogs = envExpired.internal.getLogs();
  const expiredEndDateStr = getLocalTestDateStr(new Date(pastEndTime));

  assertEqual(recoveredLogs[expiredEndDateStr].completedCount, 1, '만료 세션 1회 완료 처리됨');
  assertEqual(recoveredExpiredState.focusSlotsConsumed, 2, '슬롯 소모 2로 증가');
  assertEqual(recoveredExpiredState.sessionType, 'shortBreak', '다음 세션은 Short Break');
  assertEqual(recoveredExpiredState.sessionState, 'idle', 'BR-02: 재접속 복원 시 다음 세션은 자동 시작되지 않고 Idle 대기');
}

function test9_MemoInputPendingControlRestrictions() {
  console.log('\n--- [Test 9] Memo-Input-Pending 상태의 조작 제어 제한 검증 (BR-04) ---');
  const env = createTestInstance();

  env.internal.handleSessionCompletion();
  const state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'memoPending', 'Memo-Input-Pending 상태');

  assertEqual(env.elements.timerControls.style.display, 'none', 'BR-04: 타이머 컨트롤 버튼 숨김');
  assertEqual(env.elements.memoCard.style.display, 'block', '메모 입력창 노출');
}

function test10_ClockDriftDetection() {
  console.log('\n--- [Test 10] 시스템 시계 변경 감지 알고리즘 검증 (EC-04, NFR-01) ---');
  const env = createTestInstance();

  env.internal.startTimer();
  let state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'running', '타이머 실행 중');

  // 시계 조작 시뮬레이션: Date.now()와 performance.now() 간 델타 차이를 6초로 벌림
  env.internal.handleClockAnomaly();

  state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'paused', 'EC-04: 시계 이상 감지 시 즉시 Paused 전환');
  assertEqual(env.elements.clockModal.style.display, 'flex', '시계 이상 모달 노출');
  assertEqual(env.elements.clockWarningBanner.style.display, 'flex', '경고 배너 노출');

  // 재개 버튼 클릭
  env.elements.modalResumeBtn.click();
  state = env.internal.getTimerState();
  assertEqual(state.sessionState, 'running', '재개 시 정상 Running 복귀');
  assertEqual(env.elements.clockModal.style.display, 'none', '모달 닫힘');
}

function test11_LocalStorageFailureHandling() {
  console.log('\n--- [Test 11] localStorage 쓰기 실패 대응 검증 (EC-05) ---');
  const env = createTestInstance({}, true); // Storage failure enabled

  // 쓰기 시도
  env.internal.saveAllState();

  assertEqual(env.elements.storageErrorBanner.style.display, 'flex', 'EC-05: 쓰기 실패 시 경고 배너 노출');

  // 쓰기 정상화
  env.localStorage._setFail(false);
  env.internal.saveAllState();

  assertEqual(env.elements.storageErrorBanner.style.display, 'none', 'EC-05: 쓰기 성공 시 경고 배너 해제');
}

// Run All Tests
function runSuite() {
  test1_InitialState();
  test2_StartPauseResumeReset();
  test3_ResetSlotIndependence();
  test4_FullPomodoroCycle();
  test5_SkipTimer();
  test6_MemoAndDailyLogs();
  test7_SettingsCustomization();
  test8_DataPersistenceAndRecovery();
  test9_MemoInputPendingControlRestrictions();
  test10_ClockDriftDetection();
  test11_LocalStorageFailureHandling();

  console.log('\n====================================================');
  console.log(`Test Execution Summary:`);
  console.log(`  Total:  ${totalTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    console.error('Test Result: FALSE');
    process.exit(1);
  } else {
    console.log('Test Result: TRUE (ALL TESTS PASSED)');
    process.exit(0);
  }
}

runSuite();

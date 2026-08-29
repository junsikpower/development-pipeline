#!/usr/bin/env node
'use strict';

/*
 * Independent, PRD-derived black-box tests for pomodoro-timer.html.
 *
 * This test intentionally does not import or call PomodoroCore. It evaluates
 * the complete HTML file with a minimal DOM and browser-API test double, then
 * drives the public UI (buttons, inputs, visibility changes) and observes
 * rendered output plus localStorage. The test double exists only because the
 * in-app browser runtime is unavailable in this environment.
 */

var fs = require('fs');
var path = require('path');

var HTML_PATH = path.join(__dirname, '..', 'pomodoro-timer.html');
var html = fs.readFileSync(HTML_PATH, 'utf8');
var scriptBlocks = [];
var scriptRe = /<script>([\s\S]*?)<\/script>/g;
var scriptMatch;
while ((scriptMatch = scriptRe.exec(html))) scriptBlocks.push(scriptMatch[1]);
var combinedScripts = scriptBlocks.join('\n;\n');

var results = [];
var pendingCases = [];
function check(id, clause, condition, detail) {
  results.push({ id: id, clause: clause, pass: !!condition, detail: detail || '' });
}
function caseRun(id, clause, fn) {
  try {
    var result = fn();
    if (result && typeof result.then === 'function') {
      pendingCases.push(result.catch(function (e) {
        check(id, clause, false, '테스트 실행 예외: ' + e.message);
      }));
    }
  } catch (e) { check(id, clause, false, '테스트 실행 예외: ' + e.message); }
}
function textOf(el) { return el.textContent || ''; }
function localDateKey(timestamp) {
  var d = new Date(timestamp);
  function pad(n) { return String(n).padStart(2, '0'); }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function createHarness(options) {
  options = options || {};
  var storage = options.storage && options.storage._isStorage ? options.storage : {
    _isStorage: true,
    _raw: Object.assign({}, options.storage || {}),
    failWrites: !!options.failWrites,
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(this._raw, key) ? this._raw[key] : null;
    },
    setItem: function (key, value) {
      if (this.failWrites) throw new Error('QuotaExceededError');
      this._raw[key] = String(value);
    },
    removeItem: function (key) { delete this._raw[key]; }
  };
  if (typeof storage.failWrites !== 'boolean') storage.failWrites = !!options.failWrites;

  var RealDate = Date;
  var clock = {
    now: typeof options.now === 'number' ? options.now : RealDate.now(),
    perf: typeof options.perf === 'number' ? options.perf : 0
  };
  var intervals = {};
  var nextIntervalId = 1;
  var documentListeners = {};
  var windowListeners = {};
  var title = '뽀모도로 타이머';
  var visibilityState = 'visible';
  var notificationEvents = [];
  var audioEvents = [];
  var elements = {};

  function makeElement(tag) {
    var el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: '',
      children: [],
      value: '',
      hidden: false,
      textContent: '',
      attrs: {},
      listeners: {},
      _className: '',
      _html: '',
      appendChild: function (child) { this.children.push(child); return child; },
      addEventListener: function (type, fn) {
        (this.listeners[type] || (this.listeners[type] = [])).push(fn);
      },
      removeEventListener: function (type, fn) {
        var list = this.listeners[type] || [];
        var index = list.indexOf(fn);
        if (index >= 0) list.splice(index, 1);
      },
      dispatch: function (type, event) {
        (this.listeners[type] || []).slice().forEach(function (fn) { fn(event || {}); });
      },
      click: function () { this.dispatch('click', {}); },
      getAttribute: function (name) { return this.attrs[name]; },
      setAttribute: function (name, value) { this.attrs[name] = String(value); }
    };
    Object.defineProperty(el, 'className', {
      get: function () { return this._className; },
      set: function (value) { this._className = String(value || ''); }
    });
    Object.defineProperty(el, 'innerHTML', {
      get: function () { return this._html; },
      set: function (value) {
        this._html = String(value);
        this.textContent = this._html.replace(/<[^>]*>/g, '');
        this.children = [];
      }
    });
    el.classList = {
      add: function (name) {
        var names = el.className ? el.className.split(/\s+/).filter(Boolean) : [];
        if (names.indexOf(name) < 0) names.push(name);
        el.className = names.join(' ');
      },
      remove: function (name) {
        el.className = el.className.split(/\s+/).filter(function (x) { return x && x !== name; }).join(' ');
      },
      contains: function (name) {
        return (' ' + el.className + ' ').indexOf(' ' + name + ' ') >= 0;
      },
      toggle: function (name, force) {
        var on = typeof force === 'boolean' ? force : !this.contains(name);
        if (on) this.add(name); else this.remove(name);
        return on;
      }
    };
    return el;
  }

  [
    'app', 'storageBanner', 'sessionLabel', 'slotsIndicator', 'timeDisplay', 'timerControls',
    'startPauseBtn', 'startPauseIcon', 'startPauseLabel', 'resetBtn', 'skipBtn',
    'memoPanel', 'memoInput', 'memoSubmitBtn', 'memoSkipBtn', 'clockAnomalyPanel', 'clockResumeBtn',
    'view-timer', 'view-log', 'view-settings', 'logDateInput', 'logSummary', 'logMemoList',
    'settingsError', 'settingsSaved', 'focusInput', 'shortInput', 'longInput', 'settingsSaveBtn'
  ].forEach(function (id) { elements[id] = makeElement('DIV'); elements[id].id = id; });
  ['startPauseBtn', 'resetBtn', 'skipBtn', 'memoSubmitBtn', 'memoSkipBtn', 'clockResumeBtn', 'settingsSaveBtn']
    .forEach(function (id) { elements[id].tagName = 'BUTTON'; });
  ['logDateInput', 'focusInput', 'shortInput', 'longInput', 'memoInput']
    .forEach(function (id) { elements[id].tagName = 'INPUT'; });
  ['storageBanner', 'memoPanel', 'clockAnomalyPanel', 'view-log', 'view-settings']
    .forEach(function (id) { elements[id].hidden = true; });

  var tabTimer = makeElement('BUTTON');
  tabTimer.className = 'tab-btn active'; tabTimer.setAttribute('data-view', 'timer');
  var tabLog = makeElement('BUTTON');
  tabLog.className = 'tab-btn'; tabLog.setAttribute('data-view', 'log');
  var tabSettings = makeElement('BUTTON');
  tabSettings.className = 'tab-btn'; tabSettings.setAttribute('data-view', 'settings');
  var tabs = [tabTimer, tabLog, tabSettings];

  var documentDouble = {
    body: makeElement('BODY'),
    get title() { return title; },
    set title(value) { title = String(value); },
    get visibilityState() { return visibilityState; },
    getElementById: function (id) {
      if (!elements[id]) throw new Error('unknown element ' + id);
      return elements[id];
    },
    querySelectorAll: function (selector) { return selector === '.tab-btn' ? tabs : []; },
    createElement: function (tag) { return makeElement(tag); },
    addEventListener: function (type, fn) {
      (documentListeners[type] || (documentListeners[type] = [])).push(fn);
    },
    removeEventListener: function (type, fn) {
      var list = documentListeners[type] || [];
      var index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch: function (type, event) {
      (documentListeners[type] || []).slice().forEach(function (fn) { fn(event || {}); });
    }
  };

  function FakeDate(timestamp) {
    return arguments.length === 0 ? new RealDate(clock.now) : new RealDate(timestamp);
  }
  FakeDate.now = function () { return clock.now; };
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;

  function setIntervalDouble(fn) {
    var id = nextIntervalId++;
    intervals[id] = fn;
    return id;
  }
  function clearIntervalDouble(id) { delete intervals[id]; }

  var windowDouble = {
    __POMODORO_TEST_MODE__: false,
    AudioContext: null,
    webkitAudioContext: null,
    Notification: undefined,
    addEventListener: function (type, fn) {
      (windowListeners[type] || (windowListeners[type] = [])).push(fn);
    },
    removeEventListener: function (type, fn) {
      var list = windowListeners[type] || [];
      var index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch: function (type, event) {
      (windowListeners[type] || []).slice().forEach(function (fn) { fn(event || {}); });
    }
  };

  if (options.audio === 'ok') {
    windowDouble.AudioContext = function () {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
      audioEvents.push('context');
    };
    windowDouble.AudioContext.prototype.resume = function () {
      this.state = 'running'; return Promise.resolve();
    };
    windowDouble.AudioContext.prototype.createGain = function () {
      return {
        gain: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} },
        connect: function () { return this; }
      };
    };
    windowDouble.AudioContext.prototype.createOscillator = function () {
      audioEvents.push('oscillator');
      var oscillator = {
        type: '', frequency: { value: 0 }, _onended: null, _stopRequested: false,
        connect: function (target) { return target; },
        start: function () { audioEvents.push('start'); },
        stop: function () { audioEvents.push('stop'); this._stopRequested = true; if (this._onended) this._onended(); }
      };
      Object.defineProperty(oscillator, 'onended', {
        get: function () { return this._onended; },
        set: function (fn) { this._onended = fn; if (this._stopRequested && fn) fn(); }
      });
      return oscillator;
    };
  } else if (options.audio === 'fail') {
    windowDouble.AudioContext = function () {
      this.state = 'running'; this.currentTime = 0; this.destination = {};
    };
    windowDouble.AudioContext.prototype.createOscillator = function () { throw new Error('audio-failure'); };
  }

  var NotificationDouble;
  if (options.notification === 'granted' || options.notification === 'denied' || options.notification === 'default') {
    NotificationDouble = function (notificationTitle, notificationOptions) {
      notificationEvents.push({ title: notificationTitle, options: notificationOptions });
    };
    NotificationDouble.permission = options.notification;
    NotificationDouble.requestPermission = function () {
      NotificationDouble.permission = 'granted'; return Promise.resolve('granted');
    };
    windowDouble.Notification = NotificationDouble;
  }

  var appError = null;
  try {
    var appFunction = new Function(
      'window', 'document', 'localStorage', 'performance', 'Date',
      'setInterval', 'clearInterval', 'Notification', 'module',
      combinedScripts
    );
    appFunction(
      windowDouble, documentDouble, storage,
      { now: function () { return clock.perf; } }, FakeDate,
      setIntervalDouble, clearIntervalDouble, NotificationDouble, undefined
    );
  } catch (e) { appError = e; }

  return {
    error: appError,
    storage: storage,
    clock: clock,
    elements: elements,
    document: documentDouble,
    window: windowDouble,
    notifications: notificationEvents,
    audioEvents: audioEvents,
    intervals: intervals,
    tabs: { timer: tabTimer, log: tabLog, settings: tabSettings },
    tick: function () { if (intervals[1]) intervals[1](); },
    runInterval: function (id) { if (intervals[id]) intervals[id](); },
    advance: function (dateMs, perfMs) {
      clock.now += dateMs;
      clock.perf += typeof perfMs === 'number' ? perfMs : dateMs;
    },
    visibility: function (value) {
      visibilityState = value;
      documentDouble.dispatch('visibilitychange', {});
    },
    state: function () {
      var raw = storage.getItem('pomodoro:timerState');
      return raw ? JSON.parse(raw) : null;
    },
    logs: function () {
      var raw = storage.getItem('pomodoro:logs');
      return raw ? JSON.parse(raw) : {};
    },
    settings: function () {
      var raw = storage.getItem('pomodoro:settings');
      return raw ? JSON.parse(raw) : null;
    }
  };
}

function setSettings(app, focus, shortBreak, longBreak) {
  app.tabs.settings.click();
  app.elements.focusInput.value = String(focus);
  app.elements.shortInput.value = String(shortBreak);
  app.elements.longInput.value = String(longBreak);
  app.elements.settingsSaveBtn.click();
  app.tabs.timer.click();
}

var BASE = new Date(2026, 7, 20, 9, 0, 0, 0).getTime();
var MINUTE = 60000;

// Static constraints: PRD 3.1, NFR-02/NFR-03, 12.1.
caseRun('STATIC-01', 'PRD 3.1; NFR-02; NFR-03; 12.1', function () {
  var noExternal = !/<link\b[^>]*(?:href|src)\s*=|<(?:script|img|audio|video)\b[^>]*(?:src|href)\s*=|https?:\/\/|(?:\.mp3|\.wav|\.ogg|\.m4a)/i.test(html);
  check('STATIC-01', 'PRD 3.1; NFR-02; NFR-03; 12.1', noExternal && scriptBlocks.length === 2, '단일 HTML, 외부 네트워크/음원 참조 없음');
});
caseRun('STATIC-02', 'PRD 12.1', function () {
  var scriptOnly = scriptBlocks.join('\n');
  check('STATIC-02', 'PRD 12.1', !/\b(?:react|vue|angular|svelte)\b|\bimport\s+/i.test(scriptOnly), '순수 HTML/CSS/JavaScript 구현');
});

caseRun('FR-01-01', 'PRD 2.2; FR-01 Acceptance Criteria', function () {
  var app = createHarness({ now: BASE, perf: 1000 });
  check('FR-01-01', 'PRD 2.2; FR-01 Acceptance Criteria', !app.error && textOf(app.elements.sessionLabel) === 'Focus' && textOf(app.elements.timeDisplay) === '25:00' && !app.elements.timerControls.hidden && app.elements.slotsIndicator.children.length === 4 && app.state().status === 'idle', '초기 Focus/25:00/Idle/제어 UI');
});
caseRun('FR-01-02', 'PRD FR-01; NFR-01', function () {
  var app = createHarness({ now: BASE, perf: 1000 });
  if (app.state().status !== 'running') app.elements.startPauseBtn.click();
  var started = app.state();
  check('FR-01-02', 'PRD FR-01; NFR-01', started.status === 'running' && started.endTimestamp === BASE + 25 * MINUTE && textOf(app.elements.startPauseLabel) === '일시정지', '시작 시 절대 종료시각 저장');
  app.advance(10 * MINUTE); app.tick();
  check('FR-01-02', 'PRD FR-01 Acceptance Criteria', textOf(app.elements.timeDisplay) === '15:00', '10분 경과 후 15:00');
  app.elements.startPauseBtn.click();
  var paused = app.state();
  check('FR-01-02', 'PRD FR-01 Acceptance Criteria', paused.status === 'paused' && paused.remainingSnapshot === 15 * MINUTE && paused.endTimestamp === null, '일시정지 스냅샷');
  app.advance(40 * MINUTE); app.tick();
  check('FR-01-02', 'PRD FR-01 Acceptance Criteria', textOf(app.elements.timeDisplay) === '15:00', '일시정지 중 시간 불변');
  app.elements.resetBtn.click();
  var reset = app.state();
  check('FR-01-02', 'PRD FR-01 Acceptance Criteria', reset.status === 'idle' && textOf(app.elements.timeDisplay) === '25:00', '리셋 후 설정 길이 Idle');
});
caseRun('FR-01-03', 'PRD BR-03; FR-01 Acceptance Criteria', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  for (var i = 0; i < 3; i++) { app.elements.skipBtn.click(); app.elements.skipBtn.click(); }
  app.elements.resetBtn.click();
  var state = app.state();
  check('FR-01-03', 'PRD BR-03; FR-01 Acceptance Criteria', state.slotsConsumed === 3 && state.sessionType === 'focus' && state.status === 'idle' && textOf(app.elements.timeDisplay) === '25:00', '4번째 Focus 리셋 후 슬롯 3 유지');
});

caseRun('BR-04-01', 'PRD BR-04; FR-04/FR-05 Acceptance Criteria', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  setSettings(app, 1, 1, 1);
  app.elements.startPauseBtn.click(); app.advance(MINUTE + 1); app.tick();
  check('BR-04-01', 'PRD BR-04; FR-04/FR-05 Acceptance Criteria', app.elements.timerControls.hidden && !app.elements.memoPanel.hidden && app.elements.clockAnomalyPanel.hidden, 'Memo-Input-Pending 조작 제한/메모 UI');
  app.elements.memoSkipBtn.click();
  check('BR-04-01', 'PRD BR-04', !app.elements.timerControls.hidden && app.state().sessionType === 'shortBreak' && app.state().status === 'running', '메모 건너뛰기로 다음 세션 진입');
});

caseRun('FR-03-01', 'PRD FR-03; BR-01; 13.2 정상 실행 시나리오', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  setSettings(app, 1, 1, 1);
  var expectedNext = ['shortBreak', 'shortBreak', 'shortBreak', 'longBreak'];
  for (var slot = 0; slot < 4; slot++) {
    if (app.state().status !== 'running') app.elements.startPauseBtn.click();
    app.advance(MINUTE + 1); app.tick();
    check('FR-03-01', 'PRD FR-03; BR-01', !app.elements.memoPanel.hidden && app.state().slotsConsumed === slot + 1, 'Focus #' + (slot + 1) + ' 완료/슬롯 소모');
    app.elements.memoSkipBtn.click();
    check('FR-03-01', 'PRD FR-03 Acceptance Criteria', app.state().sessionType === expectedNext[slot] && app.state().status === 'running', 'Focus #' + (slot + 1) + ' 다음 세션');
    if (slot < 3) {
      app.advance(MINUTE + 1); app.tick();
      check('FR-03-01', 'PRD FR-03 Acceptance Criteria', app.state().sessionType === 'focus' && app.state().status === 'running' && app.elements.memoPanel.hidden, 'Short Break 종료 후 Focus 자동 시작');
    }
  }
  app.advance(MINUTE + 1); app.tick();
  var logs = app.logs(), day = localDateKey(BASE);
  check('FR-03-01', 'PRD FR-03; BR-01', app.state().sessionType === 'focus' && app.state().status === 'running' && app.state().slotsConsumed === 0 && logs[day].count === 4, 'Long Break 종료 후 Focus/슬롯 초기화 및 완료 4');
});

caseRun('FR-04-01', 'PRD FR-04; BR-01', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  setSettings(app, 1, 1, 1);
  app.elements.skipBtn.click(); app.elements.skipBtn.click();
  app.elements.skipBtn.click(); app.elements.skipBtn.click();
  check('FR-04-01', 'PRD FR-04 Acceptance Criteria', Object.keys(app.logs()).length === 0 && app.state().slotsConsumed === 2, 'Focus 스킵은 로그/완료 개수 불변, 슬롯만 소모');
  if (app.state().status !== 'running') app.elements.startPauseBtn.click();
  app.advance(MINUTE + 1); app.tick(); app.elements.memoSkipBtn.click();
  app.elements.skipBtn.click();
  app.advance(MINUTE + 1); app.tick(); app.elements.memoSkipBtn.click();
  var logs = app.logs(), count = Object.keys(logs).reduce(function (n, key) { return n + logs[key].count; }, 0);
  check('FR-04-01', 'PRD FR-04 Acceptance Criteria', app.state().sessionType === 'longBreak' && app.state().slotsConsumed === 4 && count === 2, '2 스킵+2 정상완료 후 Long Break/완료 2');
});

caseRun('FR-05-01', 'PRD FR-05; BR-04', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  setSettings(app, 1, 1, 1);
  app.elements.startPauseBtn.click(); app.advance(MINUTE + 1); app.tick();
  app.elements.memoInput.value = '  작업 메모  '; app.elements.memoSubmitBtn.click();
  var day = localDateKey(BASE), first = app.logs()[day];
  check('FR-05-01', 'PRD FR-05 Acceptance Criteria', first && first.count === 1 && first.memos[0].text === '작업 메모', '제출 메모 trim 및 완료 카운트');
  app.elements.skipBtn.click(); app.advance(MINUTE + 1); app.tick(); app.elements.memoSkipBtn.click();
  var second = app.logs()[day];
  check('FR-05-01', 'PRD FR-05 Acceptance Criteria', second && second.count === 2 && second.memos[1].text === '', '건너뛰기/빈 메모도 완료 기록');
  app.tabs.log.click();
  check('FR-05-01', 'PRD FR-05 Output', app.elements.logMemoList.children[0].children[1].textContent === '작업 메모' && app.elements.logMemoList.children[1].children[1].textContent === '메모 없음', '로그에 빈 메모를 메모 없음으로 표시');
});

caseRun('FR-06-01', 'PRD FR-06; 13.1 Functional', function () {
  var day = localDateKey(BASE);
  var logs = {};
  logs[day] = { count: 3, memos: [{ time: BASE + 3000, text: 'third' }, { time: BASE + 1000, text: 'first' }, { time: BASE + 2000, text: 'second' }] };
  var app = createHarness({ now: BASE, storage: { 'pomodoro:logs': JSON.stringify(logs) } });
  app.tabs.log.click();
  var order = app.elements.logMemoList.children.map(function (li) { return li.children[1].textContent; });
  check('FR-06-01', 'PRD FR-06 Acceptance Criteria', textOf(app.elements.logSummary).indexOf('3') >= 0 && JSON.stringify(order) === JSON.stringify(['first', 'second', 'third']), '일별 개수 및 오래된 순 정렬: summary=' + textOf(app.elements.logSummary) + ', order=' + JSON.stringify(order));
  app.elements.logDateInput.value = localDateKey(BASE - 86400000); app.elements.logDateInput.dispatch('change', {});
  check('FR-06-01', 'PRD FR-06 Acceptance Criteria', textOf(app.elements.logSummary).indexOf('0') >= 0 && app.elements.logMemoList.children.length === 1 && app.elements.logMemoList.children[0].textContent === '기록된 메모가 없습니다.', '데이터 없는 날짜 표시: summary=' + textOf(app.elements.logSummary) + ', child=' + app.elements.logMemoList.children[0].textContent);
});

caseRun('FR-07-01', 'PRD FR-07; 13.1 Functional', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  setSettings(app, 1, 180, 1);
  check('FR-07-01', 'PRD FR-07 Acceptance Criteria', app.settings().focusMin === 1 && app.settings().shortBreakMin === 180 && textOf(app.elements.timeDisplay) === '01:00', 'Idle Focus 설정 즉시 반영/1·180 경계 저장');
  app.tabs.settings.click(); app.elements.focusInput.value = '0'; app.elements.shortInput.value = '181'; app.elements.longInput.value = '25.5'; app.elements.settingsSaveBtn.click();
  check('FR-07-01', 'PRD FR-07 Acceptance Criteria', !app.elements.settingsError.hidden && app.settings().focusMin === 1 && app.settings().shortBreakMin === 180, '0/181/소수 입력 차단');
  app.elements.focusInput.value = 'abc'; app.elements.shortInput.value = '5'; app.elements.longInput.value = '15'; app.elements.settingsSaveBtn.click();
  check('FR-07-01', 'PRD FR-07 Acceptance Criteria', !app.elements.settingsError.hidden && app.settings().focusMin === 1, '비숫자 입력 차단');
});

caseRun('FR-07-02', 'PRD FR-07; 13.1 Functional', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  setSettings(app, 25, 5, 15); app.elements.startPauseBtn.click(); app.advance(5 * MINUTE); app.tick();
  var endBefore = app.state().endTimestamp, displayBefore = textOf(app.elements.timeDisplay);
  setSettings(app, 30, 5, 15);
  check('FR-07-02', 'PRD FR-07 Acceptance Criteria', app.state().endTimestamp === endBefore && textOf(app.elements.timeDisplay) === displayBefore, 'Running 세션에는 변경 설정 미적용');
  app.elements.startPauseBtn.click();
  check('FR-07-02', 'PRD FR-07 Acceptance Criteria', app.state().status === 'paused' && app.state().remainingSnapshot === 20 * MINUTE, 'Paused 세션 기존 스냅샷 유지');
  setSettings(app, 40, 5, 15);
  var reloaded = createHarness({ storage: app.storage, now: app.clock.now, perf: app.clock.perf });
  check('FR-07-02', 'PRD FR-07 Acceptance Criteria', reloaded.state().status === 'paused' && textOf(reloaded.elements.timeDisplay) === '20:00', 'Paused 복원 후 기존 길이 유지');
  reloaded.elements.startPauseBtn.click(); reloaded.advance(20 * MINUTE + 1); reloaded.tick(); reloaded.elements.memoSkipBtn.click(); reloaded.elements.skipBtn.click();
  check('FR-07-02', 'PRD FR-07 Acceptance Criteria', reloaded.state().sessionType === 'focus' && textOf(reloaded.elements.timeDisplay) === '40:00', '현재 세션 종료 후 다음 동일 유형에 새 설정 적용');
});

caseRun('FR-08-01', 'PRD FR-08; EC-03; 13.2', function () {
  var app = createHarness({ now: BASE, perf: 100 });
  setSettings(app, 2, 5, 15); app.elements.startPauseBtn.click(); app.advance(30000); app.tick();
  var reloaded = createHarness({ storage: app.storage, now: app.clock.now, perf: 10 });
  check('FR-08-01', 'PRD FR-08 Acceptance Criteria', reloaded.state().status === 'running' && textOf(reloaded.elements.timeDisplay) === '01:30' && reloaded.settings().focusMin === 2, 'Running 남은 시간/설정 복원');
});

caseRun('FR-08-02', 'PRD FR-08; EC-03; BR-02', function () {
  var restoreNow = new Date(2026, 7, 21, 0, 0, 1, 0).getTime();
  var end = restoreNow - 2000;
  var staleFocus = { sessionType: 'focus', status: 'running', endTimestamp: end, remainingSnapshot: null, slotsConsumed: 0, dateAnchor: end - 1000, perfAnchor: 0, memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false };
  var app = createHarness({ now: restoreNow, perf: 5000, storage: { 'pomodoro:timerState': JSON.stringify(staleFocus), 'pomodoro:logs': JSON.stringify({}) } });
  var logs = app.logs(), originalDate = localDateKey(end);
  check('FR-08-02', 'PRD FR-08 Acceptance Criteria', app.elements.timerControls.hidden && !app.elements.memoPanel.hidden && logs[originalDate] && logs[originalDate].count === 1, '만료 Focus 1회 종료/원래 종료시각 날짜 기록');
  app.elements.memoSkipBtn.click();
  check('FR-08-02', 'PRD FR-08; BR-02', app.state().sessionType === 'shortBreak' && app.state().status === 'idle', '재접속 만료 후 다음 세션 Idle/수동 시작');
});

caseRun('FR-08-03', 'PRD FR-08; EC-03; BR-02', function () {
  var restoreNow = new Date(2026, 7, 21, 0, 0, 1, 0).getTime();
  var staleBreak = { sessionType: 'shortBreak', status: 'running', endTimestamp: restoreNow - 1000, remainingSnapshot: null, slotsConsumed: 1, dateAnchor: 0, perfAnchor: 0, memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false };
  var app = createHarness({ now: restoreNow, perf: 5000, storage: { 'pomodoro:timerState': JSON.stringify(staleBreak), 'pomodoro:logs': JSON.stringify({}) } });
  check('FR-08-03', 'PRD FR-08; EC-03; BR-02', app.state().sessionType === 'focus' && app.state().status === 'idle' && app.elements.memoPanel.hidden && Object.keys(app.logs()).length === 0, '만료 Break는 메모/로그 없이 Focus Idle');
});

caseRun('FR-08-04', 'PRD FR-08; EC-03', function () {
  var paused = { sessionType: 'focus', status: 'paused', endTimestamp: null, remainingSnapshot: 123000, slotsConsumed: 2, dateAnchor: null, perfAnchor: null, memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false };
  var app = createHarness({ now: BASE, perf: 0, storage: { 'pomodoro:timerState': JSON.stringify(paused), 'pomodoro:settings': JSON.stringify({ focusMin: 25, shortBreakMin: 5, longBreakMin: 15 }) } });
  app.advance(4 * 60 * 60 * 1000, 4 * 60 * 60 * 1000); app.tick();
  var reloaded = createHarness({ storage: app.storage, now: app.clock.now, perf: 10 });
  check('FR-08-04', 'PRD FR-08; EC-03 Acceptance Criteria', app.state().status === 'paused' && textOf(app.elements.timeDisplay) === '02:03' && reloaded.state().status === 'paused' && textOf(reloaded.elements.timeDisplay) === '02:03', 'Paused 스냅샷은 오프라인 시간과 무관하게 복원');
});

caseRun('EC-02-01', 'PRD EC-02; FR-03', function () {
  var app = createHarness({ now: BASE, perf: 0 });
  setSettings(app, 1, 1, 1); app.elements.skipBtn.click(); app.visibility('hidden'); app.advance(MINUTE + 1); app.visibility('visible');
  check('EC-02-01', 'PRD EC-02 Acceptance Criteria', app.state().sessionType === 'focus' && app.state().status === 'running' && app.elements.memoPanel.hidden, '탭 복귀 시 만료 Break 보정/Focus 자동 시작');
});

caseRun('EC-04-01', 'PRD EC-04; NFR-01; 12.2', function () {
  var app = createHarness({ now: BASE, perf: 1000 }); app.elements.startPauseBtn.click(); app.advance(10000, 0); app.tick();
  var paused = app.state();
  check('EC-04-01', 'PRD EC-04 Acceptance Criteria', paused.status === 'paused' && paused.clockAnomalyPending === true && !app.elements.clockAnomalyPanel.hidden && app.elements.timerControls.hidden && paused.remainingSnapshot === 25 * MINUTE, '5초 이상 시계 변경 감지/안전 일시정지');
  app.elements.clockResumeBtn.click(); var resumed = app.state();
  check('EC-04-01', 'PRD EC-04 Acceptance Criteria', resumed.status === 'running' && resumed.clockAnomalyPending === false && resumed.endTimestamp === app.clock.now + 25 * MINUTE && paused.endTimestamp === null, '확인 후 현재시각 기준 재개');
});

caseRun('EC-04-02', 'PRD EC-04; NFR-01; 12.2', function () {
  // EC-04 explicitly resets both anchors on visibility return so ordinary
  // background throttling/sleep does not look like a clock change.
  var app = createHarness({ now: BASE, perf: 1000 }); app.elements.startPauseBtn.click(); app.visibility('hidden'); app.advance(10000, 10000); app.visibility('visible');
  check('EC-04-02', 'PRD EC-04; NFR-01; 12.2', app.state().status === 'running' && app.state().clockAnomalyPending === false, '탭 복귀 시 정상 경과를 시계 변경으로 오탐하지 않음');
});

caseRun('EC-01-01', 'PRD EC-01; FR-02', function () {
  var app = createHarness({ now: BASE, perf: 0, audio: 'ok', notification: 'granted' });
  setSettings(app, 1, 1, 1); app.elements.startPauseBtn.click(); app.advance(MINUTE + 1); app.tick();
  return Promise.resolve().then(function () {
    check('EC-01-01', 'PRD FR-02 Acceptance Criteria', app.audioEvents.indexOf('oscillator') >= 0 && app.notifications.length === 1, '권한 허용 시 소리/브라우저 알림 경로: audio=' + JSON.stringify(app.audioEvents) + ', notifications=' + app.notifications.length);
    var denied = createHarness({ now: BASE, perf: 0, audio: 'ok', notification: 'denied' });
    setSettings(denied, 1, 1, 1); denied.elements.startPauseBtn.click(); denied.advance(MINUTE + 1); denied.tick();
    return Promise.resolve().then(function () {
      denied.runInterval(2);
      check('EC-01-01', 'PRD EC-01 Acceptance Criteria', denied.notifications.length === 0 && denied.audioEvents.indexOf('oscillator') >= 0 && denied.document.title === '⏰ 세션 종료!', '권한 거부 시 소리+탭 제목 폴백: audio=' + JSON.stringify(denied.audioEvents) + ', notifications=' + denied.notifications.length + ', title=' + denied.document.title);
      var unsupported = createHarness({ now: BASE, perf: 0 });
      setSettings(unsupported, 1, 1, 1); unsupported.elements.startPauseBtn.click(); unsupported.advance(MINUTE + 1); unsupported.tick();
      return Promise.resolve().then(function () {
        return Promise.resolve().then(function () {
          unsupported.runInterval(2);
          check('EC-01-01', 'PRD EC-01 Acceptance Criteria', unsupported.notifications.length === 0 && unsupported.document.title === '⏰ 세션 종료!', 'Notification 미지원 시 탭 제목 폴백: notifications=' + unsupported.notifications.length + ', title=' + unsupported.document.title);
        });
      });
    });
  });
});

caseRun('EC-05-01', 'PRD EC-05; 13.1 Functional', function () {
  var app = createHarness({ now: BASE, perf: 0, failWrites: true });
  check('EC-05-01', 'PRD EC-05', !app.elements.storageBanner.hidden && !app.error, '쓰기 실패 경고 표시, 앱 부팅 지속');
  app.elements.startPauseBtn.click();
  check('EC-05-01', 'PRD EC-05', app.state() === null && !app.elements.timerControls.hidden, '쓰기 실패 중에도 조작 허용');
  app.storage.failWrites = false; app.tick();
  check('EC-05-01', 'PRD EC-05', app.elements.storageBanner.hidden && app.state() && app.state().status === 'running', '재시도 성공 시 경고 해제/상태 저장');
});

caseRun('NFR-01-01', 'PRD NFR-01; 12.2', function () {
  var app = createHarness({ now: BASE, perf: 0 }); app.elements.startPauseBtn.click(); app.advance(25 * MINUTE - 1); app.tick();
  check('NFR-01-01', 'PRD NFR-01', textOf(app.elements.timeDisplay) === '00:01' && app.state().status === 'running', '종료 1ms 전 정확한 표시');
  app.advance(1); app.tick();
  check('NFR-01-01', 'PRD NFR-01', !app.elements.memoPanel.hidden && app.state().status === 'idle', '종료 경계 정확한 상태 전이');
});

caseRun('SCOPE-01', 'PRD 3.2; 7.5', function () {
  var app = createHarness({ now: BASE });
  var labels = ['startPauseBtn', 'resetBtn', 'skipBtn', 'memoSubmitBtn', 'memoSkipBtn', 'clockResumeBtn', 'settingsSaveBtn']
    .map(function (id) { return textOf(app.elements[id]); }).join(' ');
  check('SCOPE-01', 'PRD 3.2; 7.5', !/삭제|모든 기록|데이터 초기화|clear data|delete data/i.test(labels), '앱 내 승인되지 않은 데이터 삭제 UI 없음');
});

function report() {
  var failed = results.filter(function (result) { return !result.pass; });
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}
Promise.all(pendingCases).then(report).catch(function (e) {
  console.error(e.stack || e.message || String(e));
  process.exitCode = 1;
});

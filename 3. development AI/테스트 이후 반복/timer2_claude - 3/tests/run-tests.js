#!/usr/bin/env node
'use strict';

/*
 * Self-test harness for pomodoro-timer.html.
 * Extracts the PomodoroCore block (between the /* ===CORE-START=== * / and
 * /* ===CORE-END=== * / markers) out of the single HTML file and evaluates
 * it in isolation, so the pure state-machine logic can be unit tested in
 * plain Node with zero dependencies and zero browser.
 */

var fs = require('fs');
var path = require('path');

var HTML_PATH = path.join(__dirname, '..', 'pomodoro-timer.html');
var START_MARKER = '/* ===CORE-START=== */';
var END_MARKER = '/* ===CORE-END=== */';

function loadCore() {
  var html = fs.readFileSync(HTML_PATH, 'utf8');
  var startIdx = html.indexOf(START_MARKER);
  var endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Core markers not found in pomodoro-timer.html — cannot extract PomodoroCore for testing.');
  }
  var coreSrc = html.slice(startIdx, endIdx + END_MARKER.length);
  var sandboxModule = { exports: {} };
  var fn = new Function('module', 'exports', coreSrc);
  fn(sandboxModule, sandboxModule.exports);
  if (!sandboxModule.exports || typeof sandboxModule.exports.createInitialState !== 'function') {
    throw new Error('PomodoroCore did not export expected API.');
  }
  return sandboxModule.exports;
}

var Core = loadCore();

// ---- tiny assertion framework -------------------------------------------

var pass = 0;
var fail = 0;
var failures = [];
var currentSection = '';

function section(name) { currentSection = name; }

function record(ok, label, extra) {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push('[' + currentSection + '] ' + label + (extra ? '\n    ' + extra : ''));
  }
}

function assertEqual(actual, expected, label) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  record(a === e, label, a === e ? '' : 'expected ' + e + ' but got ' + a);
}

function assertTrue(cond, label) { record(!!cond, label, 'expected truthy'); }
function assertFalse(cond, label) { record(!cond, label, 'expected falsy'); }
function assertThrowsNothing(fn, label) {
  try { fn(); record(true, label); } catch (e) { record(false, label, 'threw: ' + e.message); }
}

// ---- fixtures -------------------------------------------------------------

var SETTINGS = { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 };
var MIN = 60 * 1000;
var T0 = Date.parse('2026-08-20T09:00:00'); // arbitrary fixed local-time anchor
var P0 = 1000; // arbitrary performance.now() origin, deliberately != T0

function freshIdleFocus() {
  return Core.createInitialState();
}

// =========================================================================
// FR-01: start / pause / reset
// =========================================================================
section('FR-01 start/pause/reset');
(function () {
  var s = freshIdleFocus();
  s = Core.startSession(s, SETTINGS, T0, P0);
  assertEqual(s.status, 'running', 'start: status becomes running');
  assertEqual(s.endTimestamp, T0 + 25 * MIN, 'start: endTimestamp = now + full focus length');

  var remainingAt10Min = Core.getDisplayRemainingMs(s, SETTINGS, T0 + 10 * MIN);
  assertEqual(remainingAt10Min, 15 * MIN, 'start: remaining time matches actual elapsed time at +10min');

  var paused = Core.pauseSession(s, T0 + 10 * MIN);
  assertEqual(paused.status, 'paused', 'pause: status becomes paused');
  assertEqual(paused.remainingSnapshot, 15 * MIN, 'pause: snapshot captures remaining time');
  var stillPaused = Core.getDisplayRemainingMs(paused, SETTINGS, T0 + 50 * MIN);
  assertEqual(stillPaused, 15 * MIN, 'pause: remaining time does not change while paused, regardless of elapsed wall time');

  var reset = Core.resetSession(paused);
  assertEqual(reset.status, 'idle', 'reset: status becomes idle');
  assertEqual(Core.getDisplayRemainingMs(reset, SETTINGS, T0), 25 * MIN, 'reset: idle display returns to full configured length');

  // 3rd focus slot consumed, reset the 4th in-progress focus -> slot count must stay at 3
  var s2 = Core.createInitialState();
  s2.slotsConsumed = 3;
  s2 = Core.startSession(s2, SETTINGS, T0, P0);
  var resetAt4th = Core.resetSession(s2);
  assertEqual(resetAt4th.slotsConsumed, 3, 'reset: cycle slot count (BR-03) is unaffected by reset');

  var controlsDuringMemo = Core.getVisibleControls({ memoInputPending: true, clockAnomalyPending: false });
  assertFalse(controlsDuringMemo.showTimerControls, 'Memo-Input-Pending: start/pause/reset/skip controls are hidden (BR-04)');
  assertTrue(controlsDuringMemo.showMemoUI, 'Memo-Input-Pending: memo submit/skip UI is shown');
})();

// =========================================================================
// FR-02 / EC-01: notification channel decision matrix
// =========================================================================
section('FR-02/EC-01 notification channels');
(function () {
  var granted = Core.decideNotificationChannels({ notificationSupported: true, permission: 'granted', audioOk: true });
  assertTrue(granted.playSound, 'granted+audioOk: sound always attempted');
  assertTrue(granted.showBrowserNotification, 'granted+audioOk: browser notification sent');
  assertFalse(granted.changeTabTitle, 'granted+audioOk: no tab-title fallback needed');

  var grantedAudioFail = Core.decideNotificationChannels({ notificationSupported: true, permission: 'granted', audioOk: false });
  assertTrue(grantedAudioFail.showBrowserNotification, 'granted+audioFail: browser notification still sent');
  assertTrue(grantedAudioFail.changeTabTitle, 'granted+audioFail: audio failure independently triggers tab-title fallback');

  var denied = Core.decideNotificationChannels({ notificationSupported: true, permission: 'denied', audioOk: true });
  assertFalse(denied.showBrowserNotification, 'denied: no browser notification');
  assertTrue(denied.changeTabTitle, 'denied: sound + tab-title fallback (EC-01)');
  assertTrue(denied.playSound, 'denied: sound still attempted as primary channel');

  var unsupported = Core.decideNotificationChannels({ notificationSupported: false, permission: undefined, audioOk: true });
  assertFalse(unsupported.showBrowserNotification, 'unsupported API: no browser notification');
  assertTrue(unsupported.changeTabTitle, 'unsupported API: tab-title fallback used');
})();

// =========================================================================
// FR-03 / BR-01: cycle auto-transition (slot-consumption model)
// =========================================================================
section('FR-03/BR-01 cycle transition');
(function () {
  var s = freshIdleFocus();
  var totalCompletedCount = 0;

  function completeFocus(state, ts) {
    var res = Core.completeSession(state, SETTINGS, ts, ts, P0, { suppressAutoStart: false });
    if (res.logUpdate && res.logUpdate.type === 'incrementCount') totalCompletedCount++;
    return res.state;
  }
  function finishMemo(state, ts) {
    var res = Core.submitMemo(state, SETTINGS, '', ts, P0);
    return res.state;
  }
  function completeBreak(state, ts) {
    var res = Core.completeSession(state, SETTINGS, ts, ts, P0, { suppressAutoStart: false });
    return res.state;
  }

  // Focus #1 -> Short Break
  s = completeFocus(s, T0);
  assertTrue(s.memoInputPending, 'focus end: enters Memo-Input-Pending before next session starts');
  s = finishMemo(s, T0 + 1);
  assertEqual(s.sessionType, 'shortBreak', 'focus #1 end -> short break (slots=1)');
  assertEqual(s.status, 'running', 'break auto-starts immediately after memo step');

  s = completeBreak(s, T0 + 2);
  assertEqual(s.sessionType, 'focus', 'short break end -> focus resumes automatically, no memo step');
  assertEqual(s.status, 'running', 'focus auto-started after break');

  // Focus #2 -> Short Break
  s = completeFocus(s, T0 + 3);
  s = finishMemo(s, T0 + 4);
  assertEqual(s.sessionType, 'shortBreak', 'focus #2 end -> short break (slots=2)');
  s = completeBreak(s, T0 + 5);

  // Focus #3 -> Short Break
  s = completeFocus(s, T0 + 6);
  s = finishMemo(s, T0 + 7);
  assertEqual(s.sessionType, 'shortBreak', 'focus #3 end -> short break (slots=3)');
  s = completeBreak(s, T0 + 8);

  // Focus #4 -> Long Break (4th slot consumed)
  s = completeFocus(s, T0 + 9);
  assertEqual(s.slotsConsumed, 4, 'after 4th focus completion, slotsConsumed=4');
  s = finishMemo(s, T0 + 10);
  assertEqual(s.sessionType, 'longBreak', '4th focus slot consumed -> next is Long Break');

  s = completeBreak(s, T0 + 11);
  assertEqual(s.sessionType, 'focus', 'long break end -> focus resumes automatically');
  assertEqual(s.slotsConsumed, 0, 'long break end -> cycle slot counter resets to 0 (BR-01)');

  assertEqual(totalCompletedCount, 4, 'completed-count incremented exactly once per normally-finished focus session');
})();

// =========================================================================
// FR-04 / BR-01: skip behaviour
// =========================================================================
section('FR-04 skip');
(function () {
  var s = freshIdleFocus();

  var r1 = Core.skipSession(s, SETTINGS, T0, P0);
  assertEqual(r1.logUpdate, null, 'skip focus: no log update (count unaffected)');
  assertEqual(r1.state.sessionType, 'shortBreak', 'skip focus: still advances to short break (slot consumed)');
  assertEqual(r1.state.slotsConsumed, 1, 'skip focus: slot IS consumed even though not completed');
  assertFalse(r1.state.memoInputPending, 'skip focus: no memo step required');

  // Skip focus twice, then normally complete focus twice -> 4 slots consumed, count=2, Long Break reached
  var state = freshIdleFocus();
  state = Core.skipSession(state, SETTINGS, T0, P0).state;      // slot 1 (skip)
  state = Core.skipSession(state, SETTINGS, T0 + 1, P0).state;  // break skipped -> back to focus
  state = Core.skipSession(state, SETTINGS, T0 + 2, P0).state;  // slot 2 (skip)
  state = Core.skipSession(state, SETTINGS, T0 + 3, P0).state;  // break skipped -> back to focus

  var completedCount = 0;
  var res = Core.completeSession(state, SETTINGS, T0 + 4, T0 + 4, P0, {});
  if (res.logUpdate) completedCount++;
  state = Core.submitMemo(res.state, SETTINGS, '', T0 + 5, P0).state; // slot 3 (completed) -> short break
  state = Core.completeSession(state, SETTINGS, T0 + 6, T0 + 6, P0, {}).state; // break ends -> focus

  res = Core.completeSession(state, SETTINGS, T0 + 7, T0 + 7, P0, {});
  if (res.logUpdate) completedCount++;
  state = Core.submitMemo(res.state, SETTINGS, '', T0 + 8, P0).state; // slot 4 (completed) -> long break

  assertEqual(state.sessionType, 'longBreak', '2 skips + 2 completions = 4 slots -> Long Break reached');
  assertEqual(completedCount, 2, 'completed-count reflects only the 2 normal completions, not the 2 skips');

  var duringMemo = Core.skipSession({ memoInputPending: true }, SETTINGS, T0, P0);
  assertEqual(duringMemo.state, { memoInputPending: true }, 'skip is a no-op during Memo-Input-Pending (BR-04)');
})();

// =========================================================================
// FR-05: memo recording (empty allowed, count already reflected at completion)
// =========================================================================
section('FR-05 memo recording');
(function () {
  var s = freshIdleFocus();
  var completion = Core.completeSession(s, SETTINGS, T0, T0, P0, {});
  assertTrue(completion.state.memoInputPending, 'focus completion always opens memo prompt');

  var submitted = Core.submitMemo(completion.state, SETTINGS, '  작업 내용  ', T0 + 1, P0);
  assertEqual(submitted.logUpdate.entry.text, '작업 내용', 'submitted memo text is trimmed');
  assertEqual(submitted.logUpdate.entry.date, completion.logUpdate.date, 'memo entry attributed to the same date as the completion');

  var completion2 = Core.completeSession(freshIdleFocus(), SETTINGS, T0, T0, P0, {});
  var skipped = Core.skipMemo(completion2.state, SETTINGS, T0 + 1, P0);
  assertEqual(skipped.logUpdate.entry.text, '', 'skipping memo stores an empty text value');

  var completion3 = Core.completeSession(freshIdleFocus(), SETTINGS, T0, T0, P0, {});
  var whitespaceOnly = Core.submitMemo(completion3.state, SETTINGS, '     ', T0 + 1, P0);
  assertEqual(whitespaceOnly.logUpdate.entry.text, '', 'whitespace-only memo is normalized to empty (renders as "메모 없음")');
})();

// =========================================================================
// FR-06: daily log retrieval (count + ascending memo order)
// =========================================================================
section('FR-06 daily log view');
(function () {
  var logs = {};
  logs = Core.incrementCount(logs, '2026-08-20');
  logs = Core.incrementCount(logs, '2026-08-20');
  logs = Core.appendMemo(logs, { date: '2026-08-20', timestamp: T0 + 3000, text: 'third' });
  logs = Core.appendMemo(logs, { date: '2026-08-20', timestamp: T0 + 1000, text: 'first' });
  logs = Core.appendMemo(logs, { date: '2026-08-20', timestamp: T0 + 2000, text: 'second' });

  var view = Core.getLogForDate(logs, '2026-08-20');
  assertEqual(view.count, 2, 'log view: completed count matches number of increments');
  assertEqual(view.memos.map(function (m) { return m.text; }), ['first', 'second', 'third'], 'log view: memos sorted ascending by time regardless of insertion order');

  var emptyDay = Core.getLogForDate(logs, '2026-01-01');
  assertEqual(emptyDay, { count: 0, memos: [] }, 'log view: date with no data returns zero/empty, not undefined/crash');
})();

// =========================================================================
// FR-07: settings validation + apply-timing (Idle immediate, Running/Paused deferred)
// =========================================================================
section('FR-07 settings');
(function () {
  assertTrue(Core.validateSettingsValue('25').valid, 'validate: "25" is valid');
  assertTrue(Core.validateSettingsValue(1).valid, 'validate: lower bound 1 is valid');
  assertTrue(Core.validateSettingsValue(180).valid, 'validate: upper bound 180 is valid');
  assertFalse(Core.validateSettingsValue('0').valid, 'validate: 0 is out of range');
  assertFalse(Core.validateSettingsValue('181').valid, 'validate: 181 is out of range');
  assertFalse(Core.validateSettingsValue('25.5').valid, 'validate: decimal rejected');
  assertFalse(Core.validateSettingsValue('abc').valid, 'validate: non-numeric rejected');
  assertFalse(Core.validateSettingsValue('').valid, 'validate: empty rejected');
  assertFalse(Core.validateSettingsValue(-5).valid, 'validate: negative rejected');

  // Idle session reflects new settings immediately (derived live, no stored snapshot)
  var idleState = freshIdleFocus();
  var oldDisplay = Core.getDisplayRemainingMs(idleState, SETTINGS, T0);
  assertEqual(oldDisplay, 25 * MIN, 'idle focus shows old setting before change');
  var newSettings = { focusMin: 30, shortBreakMin: 5, longBreakMin: 15 };
  var newDisplay = Core.getDisplayRemainingMs(idleState, newSettings, T0);
  assertEqual(newDisplay, 30 * MIN, 'idle focus immediately reflects changed setting (FR-07)');

  // Running session is unaffected by a settings change made mid-session
  var runningState = Core.startSession(idleState, SETTINGS, T0, P0);
  var remainingUnderOldSettings = Core.getDisplayRemainingMs(runningState, SETTINGS, T0 + 5 * MIN);
  var remainingUnderNewSettings = Core.getDisplayRemainingMs(runningState, newSettings, T0 + 5 * MIN);
  assertEqual(remainingUnderOldSettings, remainingUnderNewSettings, 'running session remaining time is identical regardless of settings object passed in (already anchored to endTimestamp)');
  assertEqual(remainingUnderNewSettings, 20 * MIN, 'running focus keeps original 25-minute length even after settings changed to 30 (FR-07 deferred application)');

  // Paused session is likewise unaffected
  var pausedState = Core.pauseSession(runningState, T0 + 5 * MIN);
  var pausedUnderNew = Core.getDisplayRemainingMs(pausedState, newSettings, T0 + 999 * MIN);
  assertEqual(pausedUnderNew, 20 * MIN, 'paused session snapshot unaffected by settings change');
})();

// =========================================================================
// FR-08 / EC-03 / BR-02: persistence & restore
// =========================================================================
section('FR-08/EC-03/BR-02 restore');
(function () {
  // Running, not yet expired -> resumes seamlessly, anchors refreshed (perf.now resets across reload)
  var runningPersisted = {
    sessionType: 'focus', status: 'running', endTimestamp: T0 + 10 * MIN,
    remainingSnapshot: null, slotsConsumed: 0, dateAnchor: T0 - 999999, perfAnchor: -999999,
    memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false
  };
  var restored1 = Core.restoreState(runningPersisted, SETTINGS, T0, 5000);
  assertEqual(restored1.state.status, 'running', 'restore: unexpired running session stays running');
  assertEqual(restored1.state.dateAnchor, T0, 'restore: dateAnchor refreshed to current load time');
  assertEqual(restored1.state.perfAnchor, 5000, 'restore: perfAnchor refreshed (performance.now resets on reload)');
  assertEqual(Core.getDisplayRemainingMs(restored1.state, SETTINGS, T0), 10 * MIN, 'restore: remaining time preserved exactly across reload');

  // Running, expired exactly once while offline -> 1x completion, then Idle (not auto-started) — BR-02
  var expiredFocus = {
    sessionType: 'focus', status: 'running', endTimestamp: T0 - 1000,
    remainingSnapshot: null, slotsConsumed: 0, dateAnchor: T0 - 999999, perfAnchor: -999999,
    memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false
  };
  var restored2 = Core.restoreState(expiredFocus, SETTINGS, T0, 5000);
  assertTrue(restored2.state.memoInputPending, 'restore: expired focus still enters memo-input-pending (completion path reused)');
  assertEqual(restored2.logUpdate.type, 'incrementCount', 'restore: expired focus completion increments count exactly once');
  assertEqual(restored2.logUpdate.date, Core.localDateString(T0 - 1000), 'restore: log attributed to ORIGINAL endTimestamp date, not restore-time date');
  var afterMemo2 = Core.submitMemo(restored2.state, SETTINGS, '', T0, 5000);
  assertEqual(afterMemo2.state.status, 'idle', 'restore+BR-02: after memo step, next session (break) is Idle, NOT auto-started');
  assertEqual(afterMemo2.state.sessionType, 'shortBreak', 'restore+BR-02: idle session type is still correctly the short break that would have started');

  // Multiple sessions worth of offline expiry collapse into exactly ONE completion
  var multiExpired = {
    sessionType: 'focus', status: 'running', endTimestamp: T0 - 5 * 24 * 60 * MIN, // 5 days stale
    remainingSnapshot: null, slotsConsumed: 2, dateAnchor: 0, perfAnchor: 0,
    memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false
  };
  var restored3 = Core.restoreState(multiExpired, SETTINGS, T0, 5000);
  assertEqual(restored3.state.slotsConsumed, 3, 'restore: multi-day-stale session still only consumes ONE slot (single completion, not one per elapsed cycle)');

  // Running break expired while offline -> BR-02 suppresses auto-start of next focus, goes Idle directly (no memo step for breaks)
  var expiredBreak = {
    sessionType: 'shortBreak', status: 'running', endTimestamp: T0 - 1000,
    remainingSnapshot: null, slotsConsumed: 1, dateAnchor: 0, perfAnchor: 0,
    memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false
  };
  var restored4 = Core.restoreState(expiredBreak, SETTINGS, T0, 5000);
  assertEqual(restored4.state.status, 'idle', 'restore+BR-02: expired break restores directly to Idle focus (no auto-start)');
  assertEqual(restored4.state.sessionType, 'focus', 'restore: break completion advances session type to focus');
  assertEqual(restored4.logUpdate, null, 'restore: break completion never produces a log update');

  // Paused session restore: snapshot preserved verbatim regardless of offline duration
  var pausedPersisted = {
    sessionType: 'focus', status: 'paused', endTimestamp: null,
    remainingSnapshot: 7 * MIN, slotsConsumed: 0, dateAnchor: null, perfAnchor: null,
    memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false
  };
  var restored5 = Core.restoreState(pausedPersisted, SETTINGS, T0 + 999 * 24 * 60 * MIN, 999999);
  assertEqual(restored5.state.status, 'paused', 'restore: paused session stays paused regardless of elapsed offline time');
  assertEqual(restored5.state.remainingSnapshot, 7 * MIN, 'restore: paused snapshot is untouched by any expiry logic (no endTimestamp check)');
  assertEqual(restored5.logUpdate, null, 'restore: paused restore never produces a log update');

  // No persisted state at all -> fresh default state, not a crash
  var restored6 = Core.restoreState(null, SETTINGS, T0, 0);
  assertEqual(restored6.state, Core.createInitialState(), 'restore: missing persisted state falls back to fresh initial state');
})();

// =========================================================================
// EC-04: system clock change detection (delta-of-deltas algorithm)
// =========================================================================
section('EC-04 clock anomaly');
(function () {
  var running = Core.startSession(freshIdleFocus(), SETTINGS, T0, P0);

  // Normal passage of time: both clocks advance together -> no anomaly
  var normalDate = T0 + 3000;
  var normalPerf = P0 + 3000;
  assertFalse(Core.checkClockAnomaly(running, normalDate, normalPerf), 'no anomaly when Date and performance clocks agree');

  // System clock jumped forward 10s but performance.now (monotonic) only advanced 3s -> anomaly
  var jumpedDate = T0 + 13000;
  var unmovedPerf = P0 + 3000;
  assertTrue(Core.checkClockAnomaly(running, jumpedDate, unmovedPerf), 'anomaly detected when wall clock jumps but monotonic clock does not');

  // Exactly at threshold (5000ms) -> should trigger (">=", not ">")
  assertTrue(Core.checkClockAnomaly(running, T0 + 5000, P0), 'boundary: exactly 5000ms delta triggers anomaly (>=)');
  // Just under threshold -> should NOT trigger
  assertFalse(Core.checkClockAnomaly(running, T0 + 4999, P0), 'boundary: 4999ms delta does not trigger anomaly');

  // Backwards clock jump also detected (abs value)
  assertTrue(Core.checkClockAnomaly(running, T0 - 6000, P0), 'anomaly detected for a backwards clock jump too (abs delta)');

  // Idle/Paused sessions are never subject to anomaly detection
  assertFalse(Core.checkClockAnomaly(freshIdleFocus(), T0 + 999999, P0), 'idle session is never flagged for clock anomaly');

  // Freeze-at-last-known-good-value: pause uses the value handed in, not a recompute off the corrupted clock
  var frozen = Core.applyClockAnomalyPause(running, 12345);
  assertEqual(frozen.status, 'paused', 'clock anomaly: session is force-paused');
  assertEqual(frozen.remainingSnapshot, 12345, 'clock anomaly: remaining time is frozen at the last known-good value, not recomputed from the bad clock');
  assertTrue(frozen.clockAnomalyPending, 'clock anomaly: distinct pending flag set so UI can show the confirmation dialog');

  var anomalyControls = Core.getVisibleControls(frozen);
  assertTrue(anomalyControls.showClockAnomalyUI, 'clock anomaly: confirmation UI is shown');
  assertFalse(anomalyControls.showTimerControls, 'clock anomaly: normal timer controls hidden while confirmation pending');

  // Resume after confirmation reuses startSession and clears the pending flag with fresh anchors
  var resumed = Core.startSession(frozen, SETTINGS, T0 + 100000, P0 + 50);
  assertEqual(resumed.status, 'running', 'clock anomaly resume: session restarts as running');
  assertFalse(resumed.clockAnomalyPending, 'clock anomaly resume: pending flag cleared');
  assertEqual(resumed.endTimestamp, T0 + 100000 + 12345, 'clock anomaly resume: new endTimestamp computed from frozen remaining + fresh now');

  // Regression: an EC-02 background-tab catch-up must NOT immediately misfire
  // EC-04's anomaly check on the session it just auto-started. The just-completed
  // session's endTimestamp can be minutes in the past (that's the whole point of
  // EC-02 catch-up) — if the newly auto-started session's dateAnchor were taken
  // from that stale timestamp while perfAnchor is sampled fresh, the very next
  // anomaly check would see a huge synthetic dateDelta-vs-perfDelta skew and
  // wrongly pause the session as if the system clock had been tampered with.
  var staleShortBreak = {
    sessionType: 'shortBreak', status: 'running',
    endTimestamp: T0 - 6 * 60 * 1000, // scheduled to have ended 6 minutes ago (tab was backgrounded)
    remainingSnapshot: null, slotsConsumed: 1, dateAnchor: T0 - 999999, perfAnchor: -999999,
    memoInputPending: false, pendingMemo: null, suppressNextAutoStart: false, clockAnomalyPending: false
  };
  var caughtUp = Core.completeSession(staleShortBreak, SETTINGS, staleShortBreak.endTimestamp, T0, P0, { suppressAutoStart: false });
  assertEqual(caughtUp.state.status, 'running', 'EC-02 catch-up: next focus session auto-starts running');
  assertEqual(caughtUp.state.dateAnchor, T0, 'EC-02 catch-up: dateAnchor is the ACTUAL current time, not the stale scheduled endTimestamp');
  assertFalse(Core.checkClockAnomaly(caughtUp.state, T0 + 100, P0 + 100), 'EC-02 catch-up: immediately checking for clock anomaly right after does NOT false-positive');
})();

// =========================================================================
// EC-05: localStorage write-failure handling
// =========================================================================
section('EC-05 storage write failure');
(function () {
  var workingStorage = { data: {}, setItem: function (k, v) { this.data[k] = v; } };
  assertTrue(Core.trySave(workingStorage, 'k', { a: 1 }), 'trySave: succeeds against a healthy storage');

  var failingStorage = { setItem: function () { throw new Error('QuotaExceededError'); } };
  assertFalse(Core.trySave(failingStorage, 'k', { a: 1 }), 'trySave: returns false (does not throw) when storage.setItem throws');

  var brokenLoad = { getItem: function () { return '{not valid json'; } };
  assertEqual(Core.tryLoad(brokenLoad, 'k', { fallback: true }), { fallback: true }, 'tryLoad: corrupted JSON falls back to default rather than crashing');

  var missingLoad = { getItem: function () { return null; } };
  assertEqual(Core.tryLoad(missingLoad, 'k', { fallback: true }), { fallback: true }, 'tryLoad: missing key falls back to default');
})();

// =========================================================================
// NFR-01: no drift — absolute-timestamp math has zero accumulated error
// =========================================================================
section('NFR-01 long-duration accuracy');
(function () {
  var s = Core.startSession(freshIdleFocus(), SETTINGS, T0, P0);
  var FOUR_HOURS = 4 * 60 * MIN;
  var remaining = Core.getDisplayRemainingMs(s, SETTINGS, T0 + FOUR_HOURS);
  var expected = 25 * MIN - FOUR_HOURS; // deeply negative -> clamps to 0, session is long over
  assertEqual(remaining, 0, 'display remaining clamps to 0 once far past expiry, no negative/garbage values');

  var justBeforeEnd = Core.getDisplayRemainingMs(s, SETTINGS, T0 + 25 * MIN - 1);
  assertEqual(justBeforeEnd, 1, 'remaining time is exact (1ms) right up to the boundary — pure subtraction, no interval-accumulated drift');
})();

// =========================================================================
// Formatting / date utilities
// =========================================================================
section('formatting utilities');
(function () {
  assertEqual(Core.formatDuration(25 * MIN), '25:00', 'formatDuration: 25 minutes');
  assertEqual(Core.formatDuration(59 * 1000), '00:59', 'formatDuration: exact 59s displays as 00:59');
  assertEqual(Core.formatDuration(59900), '01:00', 'formatDuration: 59.9s (fractional remainder) ceils to 01:00 so display never flashes 00:00 while time remains');
  assertEqual(Core.formatDuration(0), '00:00', 'formatDuration: zero');
  assertEqual(Core.formatDuration(-500), '00:00', 'formatDuration: negative clamps to zero, never shows negative time');
  assertEqual(Core.formatDuration(5000), '00:05', 'formatDuration: single-digit seconds are zero-padded');

  assertEqual(Core.localDateString(Date.parse('2026-01-05T23:59:00')), '2026-01-05', 'localDateString: pads single-digit month/day');
  assertThrowsNothing(function () { Core.localDateString(Date.now()); }, 'localDateString: does not throw for current time');
})();

// =========================================================================
// UI wiring smoke test: boots the WHOLE file (both <script> blocks) against
// a minimal fake DOM/localStorage/Date and drives real button click
// handlers. The sections above only exercise PomodoroCore in isolation —
// this is the only pass that would catch a typo'd element id, a handler
// wired to the wrong event, or a render() call that throws.
// =========================================================================
section('UI wiring smoke test');
(function () {
  function createFakeElement(tag) {
    var elx = {
      tagName: tag || 'DIV',
      children: [],
      value: '',
      textContent: '',
      _innerHTML: '',
      hidden: false,
      className: '',
      _attrs: {},
      style: {},
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) {
        // Real DOM semantics: assigning innerHTML discards any existing child nodes.
        this._innerHTML = v;
        this.children = [];
      },
      classList: {
        _set: {},
        add: function (c) { this._set[c] = true; },
        remove: function (c) { delete this._set[c]; },
        toggle: function (c, force) {
          var on = typeof force === 'boolean' ? force : !this._set[c];
          if (on) this._set[c] = true; else delete this._set[c];
          return on;
        },
        contains: function (c) { return !!this._set[c]; }
      },
      _listeners: {},
      addEventListener: function (type, fn) {
        this._listeners[type] = this._listeners[type] || [];
        this._listeners[type].push(fn);
      },
      removeEventListener: function (type, fn) {
        var arr = this._listeners[type] || [];
        var idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      },
      dispatch: function (type, evt) {
        (this._listeners[type] || []).slice().forEach(function (fn) { fn(evt || {}); });
      },
      appendChild: function (child) { this.children.push(child); return child; },
      getAttribute: function (name) { return this._attrs[name]; },
      setAttribute: function (name, val) { this._attrs[name] = val; },
      click: function () { this.dispatch('click'); }
    };
    return elx;
  }

  var byId = {};
  ['app', 'storageBanner', 'sessionLabel', 'slotsIndicator', 'timeDisplay', 'timerControls',
    'startPauseBtn', 'startPauseIcon', 'startPauseLabel', 'resetBtn', 'skipBtn',
    'memoPanel', 'memoInput', 'memoSubmitBtn', 'memoSkipBtn',
    'clockAnomalyPanel', 'clockResumeBtn',
    'view-timer', 'view-log', 'view-settings',
    'logDateInput', 'logSummary', 'logMemoList',
    'settingsError', 'settingsSaved', 'focusInput', 'shortInput', 'longInput', 'settingsSaveBtn'
  ].forEach(function (id) { byId[id] = createFakeElement(); byId[id].id = id; });

  // Mirror the static `hidden` attributes present in the real markup.
  ['storageBanner', 'memoPanel', 'clockAnomalyPanel', 'view-log', 'view-settings'].forEach(function (id) {
    byId[id].hidden = true;
  });

  var tabTimer = createFakeElement('BUTTON'); tabTimer.className = 'tab-btn active'; tabTimer.setAttribute('data-view', 'timer');
  var tabLog = createFakeElement('BUTTON'); tabLog.className = 'tab-btn'; tabLog.setAttribute('data-view', 'log');
  var tabSettings = createFakeElement('BUTTON'); tabSettings.className = 'tab-btn'; tabSettings.setAttribute('data-view', 'settings');
  var tabButtons = [tabTimer, tabLog, tabSettings];

  var fakeBody = createFakeElement('BODY');
  var fakeDocTitle = '뽀모도로 타이머';
  var fakeVisibilityState = 'visible';
  var docListeners = {};

  var fakeDocument = {
    body: fakeBody,
    get title() { return fakeDocTitle; },
    set title(v) { fakeDocTitle = v; },
    get visibilityState() { return fakeVisibilityState; },
    getElementById: function (id) {
      if (!Object.prototype.hasOwnProperty.call(byId, id)) throw new Error('getElementById: unknown id "' + id + '"');
      return byId[id];
    },
    querySelectorAll: function (selector) {
      if (selector === '.tab-btn') return tabButtons;
      return [];
    },
    createElement: function (tag) { return createFakeElement(tag); },
    addEventListener: function (type, fn) {
      docListeners[type] = docListeners[type] || [];
      docListeners[type].push(fn);
    },
    removeEventListener: function (type, fn) {
      var arr = docListeners[type] || [];
      var idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    dispatchVisibilityChange: function () {
      (docListeners['visibilitychange'] || []).slice().forEach(function (fn) { fn({}); });
    }
  };

  function createFakeStorage() {
    var data = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      _raw: data
    };
  }
  var fakeLocalStorage = createFakeStorage();

  var fakeWindow = {
    __POMODORO_TEST_MODE__: false,
    AudioContext: undefined,
    webkitAudioContext: undefined,
    Notification: undefined,
    addEventListener: function () {},
    removeEventListener: function () {}
  };

  var RealDate = Date;
  var fakeNowMs = RealDate.now();
  var fakePerfMs = 0;
  function FakeDate(ts) {
    return typeof ts === 'undefined' ? new RealDate(fakeNowMs) : new RealDate(ts);
  }
  FakeDate.now = function () { return fakeNowMs; };
  var fakePerformance = { now: function () { return fakePerfMs; } };
  function advanceFakeTime(ms) { fakeNowMs += ms; fakePerfMs += ms; }

  var capturedTick = null;
  function fakeSetInterval(fn) { capturedTick = fn; return 1; }
  function fakeClearInterval() {}

  var html = fs.readFileSync(HTML_PATH, 'utf8');
  var scriptBlocks = [];
  var re = /<script>([\s\S]*?)<\/script>/g;
  var m;
  while ((m = re.exec(html))) { scriptBlocks.push(m[1]); }
  assertEqual(scriptBlocks.length, 2, 'expects exactly two inline <script> blocks (core + UI wiring)');
  var combinedSrc = scriptBlocks.join('\n;\n');

  var paramNames = ['window', 'document', 'localStorage', 'performance', 'Date', 'setInterval', 'clearInterval'];
  var paramValues = [fakeWindow, fakeDocument, fakeLocalStorage, fakePerformance, FakeDate, fakeSetInterval, fakeClearInterval];

  assertThrowsNothing(function () {
    var fn = new Function(paramNames.join(','), combinedSrc);
    fn.apply(null, paramValues);
  }, 'full file boots against a fake DOM without throwing');

  var Core = fakeWindow.PomodoroCore;
  assertTrue(!!Core, 'UI script correctly picks up PomodoroCore via window.PomodoroCore');
  assertTrue(typeof capturedTick === 'function', 'boot() registers the tick loop via setInterval');

  assertEqual(byId.sessionLabel.textContent, 'Focus', 'initial render: session label shows Focus');
  assertEqual(byId.timeDisplay.textContent, '25:00', 'initial render: default focus duration shown');
  assertFalse(byId.timerControls.hidden, 'initial render: timer controls visible');
  assertTrue(byId.memoPanel.hidden, 'initial render: memo panel hidden');
  assertEqual(byId.startPauseLabel.textContent, '시작', 'initial render: start/pause button reads 시작 (idle)');

  // ---- start / pause wiring ----
  byId.startPauseBtn.click();
  assertEqual(byId.startPauseLabel.textContent, '일시정지', 'after clicking start: label flips to 일시정지');
  var persistedAfterStart = JSON.parse(fakeLocalStorage.getItem('pomodoro:timerState'));
  assertEqual(persistedAfterStart.status, 'running', 'after clicking start: timer state persisted as running');

  byId.startPauseBtn.click();
  assertEqual(byId.startPauseLabel.textContent, '시작', 'after clicking pause: label flips back to 시작');
  var persistedAfterPause = JSON.parse(fakeLocalStorage.getItem('pomodoro:timerState'));
  assertEqual(persistedAfterPause.status, 'paused', 'after clicking pause: timer state persisted as paused');

  // ---- reset wiring ----
  byId.resetBtn.click();
  var persistedAfterReset = JSON.parse(fakeLocalStorage.getItem('pomodoro:timerState'));
  assertEqual(persistedAfterReset.status, 'idle', 'after clicking reset: timer state persisted as idle');

  // ---- skip wiring ----
  byId.skipBtn.click();
  assertEqual(byId.sessionLabel.textContent, 'Short Break', 'after clicking skip on idle focus: advances to Short Break');
  assertTrue(byId.slotsIndicator.children.length === 4, 'slot indicator renders exactly 4 dots');
  assertTrue(byId.slotsIndicator.children[0].className.indexOf('filled') !== -1, 'first slot dot marked filled after one focus slot consumed');

  // ---- tab switching wiring ----
  tabSettings.click();
  assertFalse(byId['view-settings'].hidden, 'clicking Settings tab: settings view becomes visible');
  assertTrue(byId['view-timer'].hidden, 'clicking Settings tab: timer view becomes hidden');
  assertTrue(tabSettings.classList.contains('active'), 'clicking Settings tab: tab button marked active');
  assertFalse(tabTimer.classList.contains('active'), 'clicking Settings tab: previously active tab button deactivated');

  // ---- settings validation wiring ----
  byId.focusInput.value = '999';
  byId.shortInput.value = '5';
  byId.longInput.value = '15';
  byId.settingsSaveBtn.click();
  assertFalse(byId.settingsError.hidden, 'invalid settings value (out of range): error banner shown');
  assertTrue(byId.settingsSaved.hidden, 'invalid settings value: success message NOT shown');

  byId.focusInput.value = '25';
  byId.settingsSaveBtn.click();
  assertTrue(byId.settingsError.hidden, 'valid settings values: error banner hidden');
  assertFalse(byId.settingsSaved.hidden, 'valid settings values: success message shown');
  var persistedSettings = JSON.parse(fakeLocalStorage.getItem('pomodoro:settings'));
  assertEqual(persistedSettings, { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 }, 'valid settings persisted to localStorage');

  tabTimer.click();

  // ---- tick-driven completion + memo flow wiring (skip is currently on Short Break; drive it back to Focus) ----
  byId.skipBtn.click(); // short break -> focus (running), slots unchanged at 1
  assertEqual(byId.sessionLabel.textContent, 'Focus', 'skip from short break returns to Focus, running');

  advanceFakeTime(26 * 60 * 1000); // push fake "now" past the 25-minute focus endTimestamp
  assertThrowsNothing(function () { capturedTick(); }, 'manually firing the tick loop past session end does not throw');
  assertFalse(byId.memoPanel.hidden, 'tick past session end: memo panel becomes visible (Memo-Input-Pending)');
  assertTrue(byId.timerControls.hidden, 'tick past session end: timer controls hidden during memo pending (BR-04)');

  byId.memoInput.value = '스모크 테스트 메모';
  byId.memoSubmitBtn.click();
  assertTrue(byId.memoPanel.hidden, 'after submitting memo: memo panel hidden again');
  assertEqual(byId.sessionLabel.textContent, 'Short Break', 'after submitting memo: auto-advanced to Short Break');
  var logsAfterMemo = JSON.parse(fakeLocalStorage.getItem('pomodoro:logs'));
  var today = Core.localDateString(fakeNowMs);
  assertTrue(!!logsAfterMemo[today], 'completed focus session logged under the correct date');
  assertEqual(logsAfterMemo[today].count, 1, 'daily completed count incremented via the real UI flow');
  assertEqual(logsAfterMemo[today].memos[0].text, '스모크 테스트 메모', 'submitted memo text persisted via the real UI flow');

  // ---- log view rendering wiring ----
  tabLog.click();
  byId.logDateInput.value = today;
  byId.logDateInput.dispatch('change');
  assertTrue(byId.logSummary.innerHTML.indexOf('1') !== -1, 'log view renders the completed count for today');
  assertTrue(byId.logMemoList.children.length === 1, 'log view renders one memo entry');

  // ---- visibilitychange (EC-02) wiring: background catch-up on a stale running session ----
  // (Submitting the memo above auto-started Short Break, which is already Running.)
  tabTimer.click();
  var stateBeforeVis = JSON.parse(fakeLocalStorage.getItem('pomodoro:timerState'));
  assertEqual(stateBeforeVis.status, 'running', 'precondition: short break auto-started and running before visibilitychange test');
  advanceFakeTime(10 * 60 * 1000); // well past the 5-minute short break
  assertThrowsNothing(function () { fakeDocument.dispatchVisibilityChange(); }, 'visibilitychange handler does not throw when catching up a stale session');
  assertEqual(byId.sessionLabel.textContent, 'Focus', 'visibilitychange catch-up: short break completion advances to Focus automatically (foreground use, BR-02 does not apply)');
})();

// ---- report ---------------------------------------------------------------

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f) { console.log('- ' + f); });
  process.exit(1);
} else {
  console.log('All tests passed.');
  process.exit(0);
}

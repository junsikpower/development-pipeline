/**
 * Independent QA harness for pomodoro-timer (PRD v4).
 * Boots index.html in jsdom with a fully controllable clock, storage,
 * audio and notification layer. Written from the PRD only.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const APP_PATH = require('path').resolve(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(APP_PATH, 'utf8');

function createStorage(initial, opts) {
  opts = opts || {};
  const map = new Map(Object.entries(initial || {}));
  const state = {
    failAll: !!opts.failAll,
    failKeys: new Set(opts.failKeys || []),
    writes: [],
    failedWrites: []
  };
  return {
    _state: state,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (state.failAll || state.failKeys.has(k)) {
        state.failedWrites.push(k);
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      state.writes.push(k);
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    key(i) { const arr = Array.from(map.keys()); return i < arr.length ? arr[i] : null; },
    get length() { return map.size; },
    _dump() { return Object.fromEntries(map); }
  };
}

async function createApp(cfg) {
  cfg = cfg || {};
  const startTime = cfg.startTime !== undefined
    ? cfg.startTime
    : new Date(2026, 2, 10, 9, 0, 0).getTime();
  let wall = startTime;
  let perf = 1000;

  const storage = createStorage(cfg.storage, cfg.storageOpts || {});
  const audioCfg = cfg.audio || {};
  const audioLog = { contexts: [], oscillatorStarts: 0, resumeCalls: 0 };
  const notifLog = [];
  let visibility = 'visible';

  let nextId = 1;
  const intervals = new Map();
  const timeouts = new Map();

  // Timers are scheduled on the MONOTONIC clock (perf), matching browser
  // setInterval semantics: a wall-clock change must not shift callback timing.
  function fakeSetInterval(fn, ms) {
    const id = nextId++;
    const iv = Math.max(1, ms | 0);
    intervals.set(id, { fn: fn, interval: iv, next: perf + iv });
    return id;
  }
  function fakeClearInterval(id) { intervals.delete(id); }
  function fakeSetTimeout(fn, ms) {
    const id = nextId++;
    timeouts.set(id, { fn: fn, at: perf + Math.max(0, ms | 0) });
    return id;
  }
  function fakeClearTimeout(id) { timeouts.delete(id); }

  function fireDue() {
    let guard = 0;
    for (;;) {
      let best = null, bestId = null, bestKind = null;
      for (const [id, e] of intervals) {
        if (e.next <= perf && (best === null || e.next < best)) { best = e.next; bestId = id; bestKind = 'i'; }
      }
      for (const [id, e] of timeouts) {
        if (e.at <= perf && (best === null || e.at < best)) { best = e.at; bestId = id; bestKind = 't'; }
      }
      if (bestId === null) return;
      if (++guard > 2000000) throw new Error('scheduler runaway');
      if (bestKind === 'i') {
        const e = intervals.get(bestId);
        e.next = best + e.interval;
        e.fn();
      } else {
        const e = timeouts.get(bestId);
        timeouts.delete(bestId);
        e.fn();
      }
    }
  }

  /** Advance wall + monotonic clock together, firing timers at their boundaries. */
  function advance(ms) {
    const target = perf + ms;
    for (;;) {
      let nextAt = null;
      for (const e of intervals.values()) if (nextAt === null || e.next < nextAt) nextAt = e.next;
      for (const e of timeouts.values()) if (nextAt === null || e.at < nextAt) nextAt = e.at;
      if (nextAt === null || nextAt > target) break;
      const step = nextAt - perf;
      perf = nextAt; wall += step;
      fireDue();
    }
    const rest = target - perf;
    perf = target; wall += rest;
    fireDue();
  }

  /**
   * Elapse real time without running any timer callback (background throttling /
   * app closed). Pending timers are re-based, i.e. missed ticks are dropped
   * rather than queued, exactly as a throttled browser tab behaves.
   */
  function advanceSilently(ms) {
    wall += ms; perf += ms;
    for (const e of intervals.values()) e.next = perf + e.interval;
    for (const [id, e] of timeouts) { if (e.at < perf) e.at = perf; }
  }

  /** Move only the wall clock (OS clock change). Monotonic clock unaffected. */
  function jumpWallClock(ms) { wall += ms; }

  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: cfg.url || 'https://qa.local/',
    beforeParse(window) {
      const RealDate = window.Date;
      class FakeDate extends RealDate {
        constructor() {
          if (arguments.length === 0) { super(wall); }
          else { super(...arguments); }
        }
        static now() { return wall; }
      }
      window.Date = FakeDate;

      Object.defineProperty(window, 'localStorage', {
        value: storage, configurable: true, writable: true
      });

      window.performance.now = function () { return perf; };

      window.setInterval = fakeSetInterval;
      window.clearInterval = fakeClearInterval;
      window.setTimeout = fakeSetTimeout;
      window.clearTimeout = fakeClearTimeout;

      Object.defineProperty(window.Document.prototype, 'visibilityState', {
        get() { return visibility; }, configurable: true
      });
      Object.defineProperty(window.Document.prototype, 'hidden', {
        get() { return visibility === 'hidden'; }, configurable: true
      });

      if (cfg.notification !== null && cfg.notification !== undefined) {
        function FakeNotification(title, options) {
          notifLog.push({ title: title, options: options });
          this.title = title;
        }
        FakeNotification.permission = cfg.notification;
        FakeNotification.requestPermission = function () { return Promise.resolve(cfg.notification); };
        window.Notification = FakeNotification;
      } else {
        delete window.Notification;
      }

      if (!audioCfg.absent) {
        class FakeAudioParam {
          setValueAtTime() { return this; }
          linearRampToValueAtTime() { return this; }
          exponentialRampToValueAtTime() { return this; }
        }
        class FakeAudioContext {
          constructor() {
            if (audioCfg.throwOnConstruct) throw new Error('AudioContext blocked');
            this.state = audioCfg.initialState || 'running';
            this.currentTime = 0;
            this.destination = {};
            audioLog.contexts.push(this);
          }
          createOscillator() {
            return {
              type: 'sine',
              frequency: new FakeAudioParam(),
              connect() {},
              start() { audioLog.oscillatorStarts++; },
              stop() {}
            };
          }
          createGain() { return { gain: new FakeAudioParam(), connect() {} }; }
          resume() {
            audioLog.resumeCalls++;
            if (audioCfg.resumeRejects) return Promise.reject(new Error('autoplay blocked'));
            this.state = 'running';
            return Promise.resolve();
          }
        }
        window.AudioContext = FakeAudioContext;
      } else {
        delete window.AudioContext;
        delete window.webkitAudioContext;
      }
    }
  });

  const window = dom.window;
  const document = window.document;

  // wait until the document finished parsing and the app's init() ran
  for (let i = 0; i < 500 && document.readyState !== 'complete'; i++) {
    await new Promise(function (r) { setImmediate(r); });
  }
  await new Promise(function (r) { setImmediate(r); });
  if (!window.__POMODORO_INTERNAL__) throw new Error('app failed to boot in jsdom');

  return {
    dom: dom, window: window, document: document,
    storage: storage, audioLog: audioLog, notifLog: notifLog,
    get internal() { return window.__POMODORO_INTERNAL__; },
    get state() { return window.__POMODORO_INTERNAL__.getTimerState(); },
    get settings() { return window.__POMODORO_INTERNAL__.getSettings(); },
    get logs() { return window.__POMODORO_INTERNAL__.getLogs(); },
    now: function () { return wall; },
    perfNow: function () { return perf; },
    advance: advance,
    advanceSilently: advanceSilently,
    jumpWallClock: jumpWallClock,
    fireDue: fireDue,
    setVisibility(v) {
      visibility = v;
      const evt = document.createEvent('Event');
      evt.initEvent('visibilitychange', true, false);
      document.dispatchEvent(evt);
    },
    $(id) { return document.getElementById(id); },
    isVisible(id) {
      const el = document.getElementById(id);
      if (!el) return false;
      return el.style.display !== 'none';
    },
    text(id) { const el = document.getElementById(id); return el ? el.textContent.trim() : null; },
    click(id) { document.getElementById(id).click(); },
    clickTab(tabId) {
      const btn = document.querySelector('.nav-tab[data-tab="' + tabId + '"]');
      if (!btn) throw new Error('nav tab not found: ' + tabId);
      btn.click();
    },
    setInput(id, v) { document.getElementById(id).value = v; },
    displayedRemaining() { return document.getElementById('timerTime').textContent.trim(); },
    displayedSeconds() {
      const parts = document.getElementById('timerTime').textContent.trim().split(':').map(Number);
      return parts[0] * 60 + parts[1];
    },
    title() { return document.title; },
    flush() { return new Promise(function (r) { setImmediate(r); }); },
    close() { try { dom.window.close(); } catch (e) {} }
  };
}

// ---------- assertion / reporting framework ----------
const results = [];
let currentSuite = '';

function suite(name) { currentSuite = name; }

async function test(id, prdRef, name, fn) {
  const rec = { id: id, suite: currentSuite, prdRef: prdRef, name: name, status: 'PASS', error: null };
  let app = null;
  try {
    app = await fn();
  } catch (e) {
    rec.status = 'FAIL';
    rec.error = (e && e.message) ? e.message : String(e);
  }
  results.push(rec);
  const mark = rec.status === 'PASS' ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} (${prdRef}) ${name}` + (rec.error ? `\n        -> ${rec.error}` : ''));
  return rec;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'equality failed'} — expected ${e}, got ${a}`);
}
function near(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${msg || 'tolerance failed'} — expected ${expected} +/-${tol}, got ${actual}`);
  }
}

/**
 * Simulate closing the browser and reopening the app after `offlineMs`
 * of real-world time. Storage contents are carried over verbatim.
 */
async function reload(app, offlineMs, overrides) {
  const snapshot = app.storage._dump();
  const reopenAt = app.now() + (offlineMs || 0);
  app.close();
  const cfg = Object.assign({}, overrides || {}, {
    storage: snapshot,
    startTime: reopenAt
  });
  if (!('notification' in cfg)) cfg.notification = (overrides && overrides.notification) || 'granted';
  return createApp(cfg);
}

module.exports = {
  createApp, createStorage, reload, suite, test, assert, eq, near, results, APP_PATH, HTML
};

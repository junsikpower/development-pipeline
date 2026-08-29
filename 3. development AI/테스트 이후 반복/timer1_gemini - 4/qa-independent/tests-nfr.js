/* Independent tests — §10 NFR, §12.1 Technical Constraints, §3.2 Out of Scope,
   §7.5 Deletion, §13 Acceptance Criteria (integration scenarios) */
const H = require('./harness');
const { createApp, reload, suite, test, assert, eq, near, HTML } = H;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

async function boot(cfg) { return createApp(Object.assign({ notification: 'granted' }, cfg || {})); }

function saveSettings(app, f, s, l) {
  app.setInput('focusDurationInput', String(f));
  app.setInput('shortBreakDurationInput', String(s));
  app.setInput('longBreakDurationInput', String(l));
  app.click('saveSettingsBtn');
}

/** app script only (strip <style>, keep <script> body + markup for SVG checks) */
const SCRIPT = HTML.slice(HTML.indexOf('<script>'), HTML.lastIndexOf('</script>'));

module.exports = async function run() {

  // =====================================================================
  suite('FR-07 + FR-08 연동 (설정 영속성 회귀)');

  await test('FR07-10', 'FR-07 AC1 / AC3 + FR-08', 'Idle 상태에서 설정 변경 후 새로고침하면 타이머 표시가 새 값으로 유지된다', async () => {
    let app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 33, 5, 15);
    app.clickTab('timerTab');
    eq(app.displayedRemaining(), '33:00', 'precondition: 저장 직후 즉시 반영');
    app = await reload(app, 1 * MIN);
    eq(app.$('focusDurationInput').value, '33', '설정 화면 값');
    eq(app.displayedRemaining(), '33:00', '새로고침 후 타이머 표시');
    app.close();
  });

  await test('FR07-11', 'FR-07 Processing (다음 시작 시 사용할 길이)', 'Idle 상태 설정 변경 후 새로고침하고 시작하면 실제 세션 길이가 새 값이다', async () => {
    let app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 33, 5, 15);
    app.clickTab('timerTab');
    app = await reload(app, 1 * MIN);
    const t0 = app.now();
    app.click('toggleBtn');
    eq((app.state.endTimestamp - t0) / MIN, 33,
      '새로고침 후 시작한 Focus 세션의 실제 길이(분)가 설정값과 다름');
    app.close();
  });

  // =====================================================================
  suite('NFR-01 타이머 정확도');

  await test('NFR01-01', 'NFR-01 / 2.3', '3시간 연속 구동 시 표시 시간과 실제 경과 시간 간 드리프트가 없다', async () => {
    const app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 180, 5, 15);
    app.clickTab('timerTab');
    const t0 = app.now();
    app.click('toggleBtn');
    const checkpoints = [30, 60, 90, 120, 150, 179];
    let prev = 0;
    for (const m of checkpoints) {
      app.advance((m - prev) * MIN);
      prev = m;
      const elapsed = (app.now() - t0) / 1000;
      const expected = 180 * 60 - elapsed;
      const shown = app.displayedSeconds();
      near(shown, expected, 0, `${m}분 경과 시점 표시 오차`);
    }
    eq(app.displayedRemaining(), '01:00', '179분 경과 후 표시');
    app.close();
  });

  await test('NFR01-02', 'NFR-01 / 12.2', 'tick이 누락되어도(스로틀링) 절대시각 기준으로 정확히 보정된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advanceSilently(13 * MIN + 27000);        // 13분 27초 동안 tick 미발생
    app.advance(250);                             // tick 1회
    eq(app.displayedRemaining(), '11:33', 'tick 누락 후 표시');
    app.close();
  });

  await test('NFR01-03', 'NFR-01 / 12.2', '카운트다운이 tick 횟수가 아닌 절대 종료 시각으로 계산된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    const endTs = app.state.endTimestamp;
    // tick을 절반만 발생시켜도 남은시간은 실제 경과 기준이어야 한다
    for (let i = 0; i < 60; i++) { app.advanceSilently(1000); app.advance(250); }
    const expected = Math.ceil((endTs - app.now()) / 1000);
    eq(app.state.remainingSeconds, expected, 'tick 횟수 의존성 발견');
    app.close();
  });

  await test('NFR01-04', 'NFR-01 / 13.3', '4시간 연속(세션 전환 포함) 구동 후에도 누적 오차가 없다', async () => {
    const app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 180, 60, 15);
    app.clickTab('timerTab');
    const t0 = app.now();
    app.click('toggleBtn');
    app.advance(180 * MIN); await app.flush();     // 180분 Focus 종료
    eq(app.state.sessionState, 'memoPending', '3시간 후 Focus 종료');
    eq(app.logs[Object.keys(app.logs)[0]].completedCount, 1, '완료 카운트');
    app.click('memoSubmitBtn');                    // -> 60분 짧은 휴식 자동 시작
    app.advance(59 * MIN);
    eq(app.displayedRemaining(), '01:00', '누적 4시간 시점 표시');
    eq((app.now() - t0) / MIN, 239, '실제 경과 시간(분)');
    app.close();
  });

  // =====================================================================
  suite('NFR-02 / NFR-03 / 12.1 기술 제약');

  await test('CON-01', '12.1 / NFR-02', '외부 네트워크 리소스(CDN·웹폰트·외부 API·외부 음원) 참조가 없다', async () => {
    const bad = [];
    const patterns = [
      [/https?:\/\//gi, 'absolute http(s) URL'],
      [/<script[^>]+src=/gi, 'external script'],
      [/<link[^>]/gi, 'link element'],
      [/@import/gi, 'css @import'],
      [/url\(\s*['"]?(https?:)?\/\//gi, 'remote css url()'],
      [/\.(mp3|wav|ogg|woff2?|ttf|otf|png|jpe?g|gif|svg)(["')?])/gi, 'external asset file reference']
    ];
    for (const [re, label] of patterns) {
      const m = HTML.match(re);
      if (m) bad.push(`${label}: ${m.slice(0, 3).join(' | ')}`);
    }
    eq(bad, [], '외부 리소스 참조 발견');
  });

  await test('CON-02', '12.1 / NFR-02', '네트워크 통신 API(fetch/XHR/WebSocket 등)를 사용하지 않는다', async () => {
    const found = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'navigator.onLine', 'importScripts']
      .filter(k => SCRIPT.includes(k));
    eq(found, [], '네트워크 API 사용 발견');
  });

  await test('CON-03', '12.1', '프레임워크(React/Vue/Angular 등)를 사용하지 않는다', async () => {
    const found = ['React', 'ReactDOM', 'Vue.', 'angular', 'jQuery', '$(document)', 'createRoot']
      .filter(k => SCRIPT.includes(k));
    eq(found, [], '프레임워크 사용 흔적 발견');
  });

  await test('CON-04', '12.1', '아이콘 등 그래픽 요소가 인라인 SVG로 구현되어 있다', async () => {
    const svgs = HTML.match(/<svg\b/gi) || [];
    assert(svgs.length >= 3, `인라인 SVG 아이콘 수 부족 (${svgs.length})`);
    assert(!/<img\b/i.test(HTML), '<img> 기반 아이콘 사용');
  });

  await test('CON-05', 'NFR-03 / 12.1', '단일 HTML 파일만으로 부팅된다 (외부 파일 로드 없음)', async () => {
    const app = await createApp({ notification: 'granted' });
    assert(app.internal, '앱이 부팅되지 않음');
    eq(app.displayedRemaining(), '25:00', '초기 화면');
    app.close();
  });

  await test('CON-06', 'NFR-03 / 1.3', 'file:// 프로토콜 컨텍스트에서도 정상 부팅·동작한다', async () => {
    const app = await createApp({
      notification: 'granted',
      url: 'file:///C:/app/index.html'
    });
    app.click('toggleBtn');
    eq(app.state.sessionState, 'running', 'file:// 환경에서 시작 동작');
    app.advance(1 * MIN);
    eq(app.displayedRemaining(), '24:00', 'file:// 환경에서 카운트다운');
    app.close();
  });

  await test('CON-07', '12.2', '승인된 기술 결정(Web Audio 합성음 / Notification API / Page Visibility / localStorage)을 사용한다', async () => {
    const required = {
      'Web Audio 합성음': /createOscillator/.test(SCRIPT),
      'Notification API': /new Notification\(/.test(SCRIPT),
      'Page Visibility API': /visibilitychange/.test(SCRIPT),
      'localStorage': /localStorage\.(setItem|getItem)/.test(SCRIPT),
      'endTimestamp 절대시각': /endTimestamp/.test(SCRIPT),
      'performance.now 앵커': /performance\.now\(\)/.test(SCRIPT)
    };
    const missing = Object.keys(required).filter(k => !required[k]);
    eq(missing, [], '승인된 기술 결정 미사용');
    assert(!/new Audio\(/.test(SCRIPT), '외부 음원 파일(Audio 엘리먼트) 사용');
  });

  await test('CON-08', '7.5 / 3.2', '앱 내 데이터 삭제 기능이 존재하지 않는다', async () => {
    assert(!/localStorage\.(clear|removeItem)/.test(SCRIPT), '앱 내 저장 데이터 삭제 코드가 존재함');
    const app = await boot();
    const labels = Array.from(app.document.querySelectorAll('button')).map(b => b.textContent.trim());
    const suspicious = labels.filter(l => /(전체\s*)?(삭제|초기화|지우기|clear|delete)/i.test(l));
    eq(suspicious, [], `데이터 삭제성 UI 발견: ${suspicious.join(', ')}`);
    app.close();
  });

  await test('CON-09', '3.2 Out of Scope', 'OS/브라우저 설정에 의한 알림 미표시를 감지·보정하려는 로직이 없다', async () => {
    const found = ['.onshow', '.onerror', '.onclose', 'notificationclick']
      .filter(k => SCRIPT.includes(k));
    eq(found, [], '범위 외(알림 표시 여부 감지) 로직 발견');
  });

  // =====================================================================
  suite('13.2 System Acceptance — 정상 실행 중 시나리오');

  await test('SYS-01', '13.2 정상 실행 중 시나리오', '포그라운드 연속 사용: 한 사이클(F×4 + SB×3 + LB) 전체가 끊김 없이 동작', async () => {
    const app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    app.click('toggleBtn');
    const expectedMemos = [];
    for (let i = 1; i <= 4; i++) {
      app.advance(25 * MIN); await app.flush();
      eq(app.state.sessionState, 'memoPending', `${i}회차 Focus 종료`);
      app.setInput('memoInput', `작업 ${i}`);
      app.click('memoSubmitBtn');
      expectedMemos.push(`작업 ${i}`);
      if (i < 4) {
        eq(app.state.sessionType, 'shortBreak', `${i}회차 후 짧은 휴식`);
        eq(app.state.sessionState, 'running', `${i}회차 휴식 자동 시작`);
        app.advance(5 * MIN); await app.flush();
        eq(app.state.sessionType, 'focus', `${i + 1}회차 Focus 자동 시작`);
      }
    }
    eq(app.state.sessionType, 'longBreak', '4회차 후 긴 휴식');
    eq(app.state.sessionState, 'running', '긴 휴식 자동 시작');
    app.advance(15 * MIN); await app.flush();
    eq(app.state.sessionType, 'focus', '긴 휴식 후 Focus');
    eq(app.state.focusSlotsConsumed, 0, '사이클 초기화');

    app.clickTab('logTab');
    eq(app.text('logCompletedCount'), '4개', '로그 완료 개수');
    const memos = Array.from(app.$('logList').querySelectorAll('.log-memo')).map(e => e.textContent.trim());
    eq(memos, expectedMemos, '로그 메모 목록');
    const times = Array.from(app.$('logList').querySelectorAll('.log-time')).map(e => e.textContent.trim());
    eq(times, ['09:25', '09:55', '10:25', '10:55'], '완료 시각 (오름차순)');
    app.close();
  });

  await test('SYS-02', '13.2 정상 실행 중 시나리오', '타이머·스킵·메모·로그·설정이 연동된 혼합 흐름', async () => {
    const app = await boot({ startTime: new Date(2026, 2, 10, 8, 0, 0).getTime() });
    app.clickTab('settingsTab');
    saveSettings(app, 10, 2, 6);
    app.clickTab('timerTab');
    eq(app.displayedRemaining(), '10:00', '설정 즉시 반영');

    app.click('toggleBtn');
    app.advance(10 * MIN); await app.flush();      // slot1 완료 08:10
    app.setInput('memoInput', '설계');
    app.click('memoSubmitBtn');
    app.advance(2 * MIN); await app.flush();       // 휴식 종료 -> focus 자동 시작

    app.click('skipBtn');                          // slot2 스킵 (카운트 X)
    app.click('skipBtn');                          // 휴식 스킵 -> focus

    app.advance(10 * MIN); await app.flush();      // slot3 완료 08:22
    app.click('memoSkipBtn');                      // 빈 메모
    app.advance(2 * MIN); await app.flush();

    app.advance(10 * MIN); await app.flush();      // slot4 완료 08:34
    app.setInput('memoInput', '마무리');
    app.click('memoSubmitBtn');

    eq(app.state.sessionType, 'longBreak', '4슬롯 소모 후 긴 휴식');
    eq(app.displayedRemaining(), '06:00', '긴 휴식 길이');

    app.clickTab('logTab');
    eq(app.text('logCompletedCount'), '3개', '완료 개수 (스킵 1회 제외)');
    const memos = Array.from(app.$('logList').querySelectorAll('.log-memo')).map(e => e.textContent.trim());
    eq(memos, ['설계', '메모 없음', '마무리'], '메모 목록');
    app.close();
  });

  // =====================================================================
  suite('13.2 System Acceptance — 재접속 복원 시나리오');

  await test('SYS-03', '13.2 재접속 복원 (Running)', 'Running 상태로 종료 후 만료된 채 재접속 → 1회 종료 처리 + 수동 시작', async () => {
    let app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    app.click('toggleBtn');                        // 09:00 ~ 09:25 Focus
    app.advance(5 * MIN);
    app = await reload(app, 6 * HOUR);             // 15:05 재접속

    eq(app.logs['2026-03-10'].completedCount, 1, '완료 처리 1회');
    eq(app.state.sessionType, 'shortBreak', '다음 세션 타입');
    eq(app.state.sessionState, 'idle', 'BR-02: 자동 시작하지 않음');

    app.click('toggleBtn');                        // 사용자가 직접 시작
    eq(app.state.sessionState, 'running', '수동 시작');
    app.advance(5 * MIN); await app.flush();
    eq(app.state.sessionType, 'focus', '휴식 종료 후 Focus 자동 시작');
    app.advance(25 * MIN); await app.flush();
    app.click('memoSubmitBtn');
    eq(app.logs['2026-03-10'].completedCount, 2, '재개 후 완료 카운트 누적');
    app.close();
  });

  await test('SYS-04', '13.2 재접속 복원 (Paused)', 'Paused 상태로 종료 후 재접속 → 스냅샷 복원 + 재개 시 정상 진행', async () => {
    let app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    app.click('toggleBtn');
    app.advance(9 * MIN);
    app.click('toggleBtn');                        // pause at 16:00
    eq(app.displayedRemaining(), '16:00', 'precondition');
    app = await reload(app, 20 * HOUR);            // 다음날 05:09 재접속

    eq(app.state.sessionState, 'paused', '상태');
    eq(app.displayedRemaining(), '16:00', '남은시간 스냅샷');
    eq(Object.keys(app.logs).length, 0, '종료 처리되지 않음');

    app.click('toggleBtn');                        // 재개
    app.advance(16 * MIN); await app.flush();
    eq(app.state.sessionState, 'memoPending', '재개 후 정상 종료');
    app.click('memoSubmitBtn');
    eq(app.state.sessionType, 'shortBreak', '다음 세션');
    app.close();
  });

  // =====================================================================
  suite('13.3 User Acceptance');

  await test('USR-01', '13.3', '하루 사용 후 로그의 완료 개수·메모가 실제 작업 내역과 일치한다', async () => {
    const app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    const done = [];
    app.click('toggleBtn');
    for (let i = 1; i <= 5; i++) {
      if (i === 3) {                               // 3회차는 스킵
        app.click('skipBtn'); app.click('skipBtn');
        continue;
      }
      app.advance(25 * MIN); await app.flush();
      const memo = (i === 4) ? '' : `업무 ${i}`;
      app.setInput('memoInput', memo);
      app.click(memo ? 'memoSubmitBtn' : 'memoSkipBtn');
      done.push(memo === '' ? '메모 없음' : memo);
      if (app.state.sessionState === 'running') {
        app.advance(app.state.remainingSeconds * 1000); await app.flush();
      }
    }
    app.clickTab('logTab');
    eq(app.text('logCompletedCount'), String(done.length) + '개', '완료 개수');
    const memos = Array.from(app.$('logList').querySelectorAll('.log-memo')).map(e => e.textContent.trim());
    eq(memos, done, '메모 목록');
    app.close();
  });

  await test('USR-02', '13.3', '임의 시점 새로고침 후에도 진행 중 세션·설정·로그가 그대로 유지된다', async () => {
    let app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    app.clickTab('settingsTab');
    saveSettings(app, 20, 4, 12);
    app.clickTab('timerTab');
    app.click('toggleBtn');
    app.advance(20 * MIN); await app.flush();
    app.setInput('memoInput', '오전 작업');
    app.click('memoSubmitBtn');                    // -> 4분 휴식 running
    app.advance(1 * MIN);
    const shown = app.displayedRemaining();
    const logsBefore = JSON.parse(JSON.stringify(app.logs));

    app = await reload(app, 0);                    // 즉시 새로고침
    eq(app.state.sessionState, 'running', '진행 중 세션 유지');
    eq(app.state.sessionType, 'shortBreak', '세션 타입 유지');
    eq(app.displayedRemaining(), shown, '남은시간 유지');
    eq(app.settings, { focusDuration: 20, shortBreakDuration: 4, longBreakDuration: 12 }, '설정 유지');
    eq(app.logs, logsBefore, '로그 유지');
    app.close();
  });

  await test('USR-03', '13.3', '시스템 시계 변경 시 타이머가 임의로 늘거나 줄지 않고 일시정지 + 확인 요청', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(8 * MIN);
    const before = app.state.remainingSeconds;
    app.jumpWallClock(-2 * HOUR);
    app.advance(250);
    eq(app.state.sessionState, 'paused', '일시정지');
    assert(app.isVisible('clockModal') || app.isVisible('clockWarningBanner'), '확인 요청 미표시');
    near(app.state.remainingSeconds, before, 1, '남은시간이 임의로 변경됨');
    app.close();
  });

  await test('USR-04', '13.3 / EC-05', '저장이 되지 않는 상황에서도 사용자는 경고로 이를 인지할 수 있다', async () => {
    const app = await boot({ storageOpts: { failAll: true } });
    app.click('toggleBtn');
    assert(app.isVisible('storageErrorBanner'), '경고 미표시');
    app.advance(25 * MIN); await app.flush();
    app.click('memoSubmitBtn');
    assert(app.isVisible('storageErrorBanner'), '지속 실패 중 경고가 사라짐');
    app.close();
  });
};

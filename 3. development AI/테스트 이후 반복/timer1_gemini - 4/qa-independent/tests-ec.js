/* Independent tests — FR-07, FR-08, and Section 8 Error & Edge Cases */
const H = require('./harness');
const { createApp, reload, suite, test, assert, eq, near } = H;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

async function boot(cfg) { return createApp(Object.assign({ notification: 'granted' }, cfg || {})); }

function saveSettings(app, f, s, l) {
  app.setInput('focusDurationInput', String(f));
  app.setInput('shortBreakDurationInput', String(s));
  app.setInput('longBreakDurationInput', String(l));
  app.click('saveSettingsBtn');
}

module.exports = async function run() {

  // =====================================================================
  suite('FR-07 설정 (세션 길이 커스터마이징)');

  await test('FR07-01', 'FR-07 Processing', '기본값은 집중 25 / 짧은휴식 5 / 긴휴식 15 분', async () => {
    const app = await boot();
    eq(app.settings, { focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15 }, '기본 설정값');
    app.close();
  });

  await test('FR07-02', 'FR-07 AC1', '변경한 설정값이 새로고침 후에도 유지된다', async () => {
    let app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 40, 8, 20);
    eq(app.settings.focusDuration, 40, '저장 직후');
    app = await reload(app, 5 * MIN);
    eq(app.settings, { focusDuration: 40, shortBreakDuration: 8, longBreakDuration: 20 }, '새로고침 후');
    eq(app.$('focusDurationInput').value, '40', '설정 화면 표시값');
    app.close();
  });

  await test('FR07-03', 'FR-07 AC2', '범위를 벗어난 값(0, 181, 소수, 비숫자, 음수)은 저장되지 않는다', async () => {
    const invalid = ['0', '181', '12.5', 'abc', '', '-5', '1000'];
    for (const v of invalid) {
      const app = await boot();
      app.clickTab('settingsTab');
      saveSettings(app, v, 5, 15);
      eq(app.settings.focusDuration, 25, `입력값 "${v}" 이 저장됨`);
      assert(app.isVisible('focusError'), `입력값 "${v}" 에 대해 오류 표시가 없음`);
      app.close();
    }
  });

  await test('FR07-04', 'FR-07 Processing', '경계값 1분과 180분은 정상 저장된다', async () => {
    const app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 1, 180, 1);
    eq(app.settings.focusDuration, 1, '1분');
    eq(app.settings.shortBreakDuration, 180, '180분');
    app.close();
  });

  await test('FR07-05', 'FR-07 AC2', '일부 항목만 유효하지 않으면 전체 저장이 차단된다', async () => {
    const app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 30, 0, 20);
    eq(app.settings, { focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15 },
      '하나라도 유효하지 않으면 어떤 값도 저장되면 안 됨');
    app.close();
  });

  await test('FR07-06', 'FR-07 AC3', 'Idle 상태 Focus에서 설정 변경 시 화면 표시가 즉시 갱신된다', async () => {
    const app = await boot();
    eq(app.displayedRemaining(), '25:00', '변경 전');
    app.clickTab('settingsTab');
    saveSettings(app, 40, 5, 15);
    app.clickTab('timerTab');
    eq(app.displayedRemaining(), '40:00', '변경 후 즉시 반영');
    eq(app.state.remainingSeconds, 40 * 60, 'remainingSeconds');
    app.close();
  });

  await test('FR07-07', 'FR-07 AC4', 'Running 상태 Focus는 기존 길이로 계속되고 다음 Focus부터 새 값 적용', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(5 * MIN);
    const endTs = app.state.endTimestamp;
    app.clickTab('settingsTab');
    saveSettings(app, 40, 5, 15);
    app.clickTab('timerTab');
    eq(app.state.endTimestamp, endTs, '진행 중 세션의 종료 목표 시각이 변경됨');
    eq(app.displayedRemaining(), '20:00', '진행 중 세션 표시');
    app.advance(20 * MIN); await app.flush();      // 기존 25분 길이로 종료
    app.click('memoSubmitBtn');                    // -> short break running
    app.advance(5 * MIN); await app.flush();       // break 종료 -> 다음 focus
    eq(app.state.sessionType, 'focus', '다음 세션 타입');
    eq(app.displayedRemaining(), '40:00', '다음 Focus 세션 길이');
    app.close();
  });

  await test('FR07-08', 'FR-07 AC4', 'Paused 상태 Focus는 남은시간이 유지되고 다음 Focus부터 새 값 적용', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(5 * MIN);
    app.click('toggleBtn');                        // pause
    const snap = app.state.remainingSeconds;
    app.clickTab('settingsTab');
    saveSettings(app, 40, 5, 15);
    app.clickTab('timerTab');
    eq(app.state.remainingSeconds, snap, '일시정지 세션의 남은시간이 변경됨');
    eq(app.state.sessionState, 'paused', '상태 유지');
    app.close();
  });

  await test('FR07-09', 'FR-07 Processing', 'Idle 상태 휴식 세션에도 새 길이가 즉시 적용된다', async () => {
    const app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 25, 9, 15);
    app.clickTab('timerTab');
    app.click('toggleBtn');
    app.click('skipBtn');                          // focus skip -> short break auto start
    eq(app.state.sessionType, 'shortBreak', 'precondition');
    eq(app.displayedRemaining(), '09:00', '변경된 짧은 휴식 길이');
    app.close();
  });

  // =====================================================================
  suite('FR-08 / EC-03 데이터 영속성 및 상태 복원');

  await test('FR08-01', 'FR-08 AC1', 'Running 중 새로고침 → 남은시간/세션이 그대로 이어진다', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.advance(10 * MIN);
    app = await reload(app, 30 * 1000);            // 30초 후 재접속
    eq(app.state.sessionState, 'running', '상태');
    eq(app.state.sessionType, 'focus', '세션 타입');
    near(app.state.remainingSeconds, 14 * 60 + 30, 1, '남은시간(초)');
    eq(app.displayedRemaining(), '14:30', '표시');
    app.close();
  });

  await test('FR08-02', 'FR-08 AC1', '새로고침 후에도 설정값과 로그가 유지된다', async () => {
    let app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 30, 6, 18);
    app.clickTab('timerTab');
    app.click('toggleBtn');
    app.advance(30 * MIN); await app.flush();
    app.setInput('memoInput', '복원 검증용 메모');
    app.click('memoSubmitBtn');
    const logsBefore = JSON.parse(JSON.stringify(app.logs));
    app = await reload(app, 1 * MIN);
    eq(app.settings, { focusDuration: 30, shortBreakDuration: 6, longBreakDuration: 18 }, '설정 복원');
    eq(app.logs, logsBefore, '로그 복원');
    app.close();
  });

  await test('FR08-03', 'FR-08 AC2 / EC-03', '오프라인 중 여러 세션이 경과해도 완료 처리는 1회만', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.advance(1 * MIN);
    app = await reload(app, 5 * HOUR);             // 5시간 후 재접속 (여러 세션 경과 가능 구간)
    const dates = Object.keys(app.logs);
    eq(dates.length, 1, '로그가 기록된 날짜 수');
    eq(app.logs[dates[0]].completedCount, 1, '완료 카운트는 1이어야 함');
    eq(app.state.focusSlotsConsumed, 1, '슬롯 소모도 1회');
    app.close();
  });

  await test('FR08-04', 'FR-08 AC3 / BR-02', '복원 후 다음 세션은 자동 시작되지 않고 Idle로 대기', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.advance(1 * MIN);
    app = await reload(app, 3 * HOUR);
    eq(app.state.sessionState, 'idle', '복원 후 세션 상태');
    eq(app.state.sessionType, 'shortBreak', '다음 세션 타입');
    eq(app.state.endTimestamp, null, 'endTimestamp');
    app.advance(10 * MIN);
    eq(app.state.sessionState, 'idle', '방치해도 자동 시작되면 안 됨');
    app.close();
  });

  await test('FR08-05', 'FR-08 AC2 / EC-03', '복원 시 완료 처리된 세션의 로그는 원래 종료 목표 시각 기준 날짜에 귀속', async () => {
    // 3/10 23:40 에 25분 Focus 시작 -> 3/11 00:05 만료. 3/12 10:00 재접속.
    let app = await boot({ startTime: new Date(2026, 2, 10, 23, 40, 0).getTime() });
    app.click('toggleBtn');
    eq(app.state.endTimestamp, new Date(2026, 2, 11, 0, 5, 0).getTime(), 'precondition endTimestamp');
    app.advance(1 * MIN);
    app = await reload(app, 34 * HOUR);            // 3/12 09:41 재접속
    eq(Object.keys(app.logs), ['2026-03-11'], '로그 귀속 날짜 (종료 목표 시각 기준)');
    eq(app.logs['2026-03-11'].completedCount, 1, '완료 카운트');
    app.close();
  });

  await test('FR08-06', 'FR-08 AC4 / EC-03', 'Paused 상태로 새로고침하면 오프라인 시간과 무관하게 스냅샷 유지', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.advance(7 * MIN);
    app.click('toggleBtn');                        // pause -> 18:00 근방
    const snap = app.state.remainingSeconds;
    app = await reload(app, 12 * HOUR);
    eq(app.state.sessionState, 'paused', '상태');
    eq(app.state.remainingSeconds, snap, '남은시간 스냅샷');
    eq(Object.keys(app.logs).length, 0, 'Paused 세션이 종료 처리되면 안 됨');
    eq(app.state.endTimestamp, null, 'endTimestamp 미사용');
    app.close();
  });

  await test('FR08-07', 'FR-08 Processing', '사이클 내 소모된 Focus 슬롯 수가 복원된다', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.click('skipBtn'); app.click('skipBtn');    // slot1 소모, focus running
    app.click('skipBtn'); app.click('skipBtn');    // slot2 소모, focus running
    eq(app.state.focusSlotsConsumed, 2, 'precondition');
    app.click('toggleBtn');                        // pause
    app = await reload(app, 2 * MIN);
    eq(app.state.focusSlotsConsumed, 2, '복원된 슬롯 수');
    app.close();
  });

  await test('FR08-08', 'EC-03', '복원 시 만료된 휴식 세션도 1회 종료 처리 후 다음 Focus는 Idle 대기', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.click('skipBtn');                          // -> short break running
    app.advance(1 * MIN);
    app = await reload(app, 4 * HOUR);
    eq(app.state.sessionType, 'focus', '다음 세션 타입');
    eq(app.state.sessionState, 'idle', '자동 시작되면 안 됨');
    eq(Object.keys(app.logs).length, 0, '휴식 종료는 완료 카운트에 영향 없음');
    app.close();
  });

  await test('FR08-09', 'EC-03 사용자에게 표시되는 결과', '복원 시 만료된 Focus 세션의 종료 처리에 알림이 포함된다', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.advance(1 * MIN);
    app = await reload(app, 3 * HOUR);
    await app.flush();
    app.advance(900);
    const notified = app.notifLog.length > 0
      || app.audioLog.oscillatorStarts > 0
      || app.title() !== '뽀모도로 타이머';
    assert(notified,
      'EC-03: 만료 세션의 종료 처리에 "알림"이 포함되어야 하나 소리/브라우저 알림/탭 제목 어느 것도 발생하지 않음');
    app.close();
  });

  await test('FR08-10', 'EC-03 사용자에게 표시되는 결과 / FR-05', '복원 시 만료된 Focus 세션의 종료 처리에 메모 입력이 포함된다', async () => {
    let app = await boot();
    app.click('toggleBtn');
    app.advance(1 * MIN);
    app = await reload(app, 3 * HOUR);
    assert(app.isVisible('memoCard'),
      `EC-03: 만료 세션 종료 처리는 "알림/메모 입력 포함" 이어야 하나 메모 입력 UI가 노출되지 않음 (state=${app.state.sessionState})`);
    app.close();
  });

  await test('FR08-11', 'FR-08 Processing', 'Idle 상태로 새로고침하면 세션 타입과 길이가 그대로 유지된다', async () => {
    let app = await boot();
    app.clickTab('settingsTab');
    saveSettings(app, 33, 5, 15);
    app.clickTab('timerTab');
    app = await reload(app, 2 * HOUR);
    eq(app.state.sessionState, 'idle', '상태');
    eq(app.displayedRemaining(), '33:00', '표시 길이');
    app.close();
  });

  await test('FR08-12', '7.2 / 12.2', '설정 / 로그 / 진행 중 타이머 상태가 각각 별도 키로 저장된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    const keys = Object.keys(app.storage._dump()).sort();
    eq(keys.length, 3, `저장 키 개수 (${keys.join(', ')})`);
    const values = keys.map(k => JSON.parse(app.storage.getItem(k)));
    assert(values.some(v => v && v.focusDuration !== undefined), '설정 전용 키 없음');
    assert(values.some(v => v && v.sessionType !== undefined), '타이머 상태 전용 키 없음');
    assert(values.some(v => v && v.focusDuration === undefined && v.sessionType === undefined), '로그 전용 키 없음');
    app.close();
  });

  // =====================================================================
  suite('EC-02 탭 비활성화 중 세션 종료');

  await test('EC02-01', 'EC-02', '백그라운드에서 세션이 만료되면 탭 복귀 즉시 종료 처리된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(5 * MIN);
    app.setVisibility('hidden');
    app.advanceSilently(30 * MIN);                 // 스로틀링으로 tick 미발생
    eq(app.state.sessionState, 'running', '백그라운드 동안에는 아직 종료 처리 전');
    app.setVisibility('visible');
    await app.flush();
    eq(app.state.sessionState, 'memoPending', '복귀 즉시 종료 처리');
    const today = Object.keys(app.logs)[0];
    eq(app.logs[today].completedCount, 1, '완료 카운트');
    app.close();
  });

  await test('EC02-02', 'EC-02', '백그라운드 복귀 시 알림/메모 흐름이 진행된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.setVisibility('hidden');
    app.advanceSilently(26 * MIN);
    app.setVisibility('visible');
    await app.flush();
    assert(app.isVisible('memoCard'), '메모 입력 UI 미노출');
    eq(app.notifLog.length, 1, '알림 발송');
    app.close();
  });

  await test('EC02-03', 'EC-02 데이터 처리', '만료 전 백그라운드 복귀 시 절대시각 기준으로 남은시간이 정확히 보정된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    const endTs = app.state.endTimestamp;
    app.setVisibility('hidden');
    app.advanceSilently(10 * MIN);
    app.setVisibility('visible');
    eq(app.state.sessionState, 'running', '상태 유지');
    eq(app.state.endTimestamp, endTs, '종료 목표 시각 불변');
    eq(app.displayedRemaining(), '15:00', '보정된 표시');
    app.advance(1 * MIN);
    eq(app.displayedRemaining(), '14:00', '복귀 후 정상 카운트다운');
    app.close();
  });

  // =====================================================================
  suite('EC-04 시스템 시계 변경');

  await test('EC04-01', 'EC-04 시스템 상태', '시계 델타 차이가 5초 이상이면 세션을 즉시 Paused로 전환', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(3 * MIN);
    app.jumpWallClock(30 * MIN);                   // OS 시계만 30분 점프
    app.advance(250);
    eq(app.state.sessionState, 'paused', '세션 상태');
    eq(app.state.endTimestamp, null, 'endTimestamp 해제');
    app.close();
  });

  await test('EC04-02', 'EC-04 사용자에게 표시되는 결과', '시계 변경 감지 시 확인 알림과 재개 버튼이 제공된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(3 * MIN);
    app.jumpWallClock(30 * MIN);
    app.advance(250);
    assert(app.isVisible('clockModal') || app.isVisible('clockWarningBanner'), '확인 알림 미표시');
    const txt = (app.text('clockModal') || '') + (app.text('clockWarningBanner') || '');
    assert(/시스템 시간 변경이 감지되어 타이머가 일시정지되었습니다/.test(txt.replace(/\s+/g, ' ')),
      `EC-04 지정 문구가 표시되지 않음: ${txt.replace(/\s+/g, ' ').slice(0, 120)}`);
    assert(app.$('modalResumeBtn') || app.$('bannerResumeBtn'), '재개 버튼 없음');
    app.close();
  });

  await test('EC04-03', 'EC-04 데이터 처리', '시계 변경 시 남은시간은 직전 유효값으로 고정되고 임의로 연장·단축되지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(10 * MIN);
    const lastValid = app.state.remainingSeconds;         // 900초 (15:00)
    eq(lastValid, 15 * 60, 'precondition: 직전 유효 남은시간');
    app.jumpWallClock(1 * HOUR);
    app.advance(250);
    eq(app.state.sessionState, 'paused', 'precondition: 이상 감지됨');
    near(app.state.remainingSeconds, lastValid, 1,
      `남은시간이 임의로 변경됨 (직전 유효값 ${lastValid}초 → 고정값 ${app.state.remainingSeconds}초)`);
    app.close();
  });

  await test('EC04-04', 'EC-04 재시도/복구 정책', '사용자가 재개하면 현재 시각 기준으로 새 종료 목표 시각을 계산하고 Running 전환', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(3 * MIN);
    app.jumpWallClock(30 * MIN);
    app.advance(250);
    const remaining = app.state.remainingSeconds;
    const t = app.now();
    app.click('modalResumeBtn');
    eq(app.state.sessionState, 'running', '상태');
    eq(app.state.endTimestamp, t + remaining * 1000, '새 종료 목표 시각');
    assert(!app.isVisible('clockModal'), '모달이 닫히지 않음');
    assert(!app.isVisible('clockWarningBanner'), '배너가 닫히지 않음');
    app.close();
  });

  await test('EC04-05', 'EC-04 발생 조건', '재개하지 않으면 Paused 상태로 유지된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(3 * MIN);
    app.jumpWallClock(30 * MIN);
    app.advance(250);
    const snap = app.state.remainingSeconds;
    app.advance(20 * MIN);
    eq(app.state.sessionState, 'paused', '상태 유지');
    eq(app.state.remainingSeconds, snap, '남은시간 유지');
    app.close();
  });

  await test('EC04-06', 'EC-04 발생 조건 (임계값)', '임계값 미만(4초)의 오차로는 시계 변경으로 오판정하지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(3 * MIN);
    app.jumpWallClock(4000);
    app.advance(250);
    eq(app.state.sessionState, 'running', '4초 오차에서 오탐지 발생');
    app.close();
  });

  await test('EC04-07', 'EC-04 발생 조건', '시계를 과거로 되돌린 경우에도 감지된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(3 * MIN);
    app.jumpWallClock(-20 * MIN);
    app.advance(250);
    eq(app.state.sessionState, 'paused', '역방향 시계 변경 미감지');
    app.close();
  });

  await test('EC04-08', 'EC-04 / 12.2 (앵커 델타 비교)', '원시값 비교가 아닌 앵커 대비 델타 비교를 사용한다 (정상 구동 중 오탐지 없음)', async () => {
    const app = await boot();
    app.click('toggleBtn');
    // Date.now()와 performance.now()의 원시값은 1e12 이상 차이가 남
    assert(Math.abs(app.now() - app.perfNow()) > 1e11, '전제: 두 클록의 원시값 기준점이 크게 다름');
    app.advance(20 * MIN);
    eq(app.state.sessionState, 'running', '정상 구동 중 오탐지 발생 (원시값 비교 의심)');
    app.close();
  });

  await test('EC04-09', 'EC-04 발생 조건', '탭 복귀 시 앵커가 재설정되어 백그라운드 경과가 오탐지되지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.setVisibility('hidden');
    app.advanceSilently(10 * MIN);                 // 정상적인 백그라운드 경과 (두 클록 동일)
    app.setVisibility('visible');
    eq(app.state.sessionState, 'running', '백그라운드 경과로 오탐지 발생');
    app.advance(2 * MIN);
    eq(app.state.sessionState, 'running', '앵커 재설정 후에도 오탐지 없음');
    app.close();
  });

  // =====================================================================
  suite('EC-05 localStorage 쓰기 실패');

  await test('EC05-01', 'EC-05 사용자에게 표시되는 결과', '쓰기 실패 시 경고 배너가 표시된다', async () => {
    const app = await boot({ storageOpts: { failAll: true } });
    app.click('toggleBtn');
    assert(app.isVisible('storageErrorBanner'), '경고 배너 미표시');
    const t = app.text('storageErrorBanner').replace(/\s+/g, ' ');
    assert(/데이터가 저장되지 않고 있습니다/.test(t), `EC-05 지정 문구 불일치: ${t}`);
    app.close();
  });

  await test('EC05-02', 'EC-05 시스템 상태', '쓰기 실패 중에도 타이머와 세션 진행이 중단되지 않는다', async () => {
    const app = await boot({ storageOpts: { failAll: true } });
    app.click('toggleBtn');
    eq(app.state.sessionState, 'running', '시작 동작');
    app.advance(10 * MIN);
    eq(app.displayedRemaining(), '15:00', '카운트다운 정상 동작');
    app.advance(15 * MIN); await app.flush();
    eq(app.state.sessionState, 'memoPending', '세션 종료 처리 정상');
    app.setInput('memoInput', '저장 실패 중 메모');
    app.click('memoSubmitBtn');
    eq(app.state.sessionType, 'shortBreak', '다음 세션 전환 정상');
    eq(app.logs[Object.keys(app.logs)[0]].completedCount, 1, '메모리 상 데이터는 유지');
    app.close();
  });

  await test('EC05-03', 'EC-05 데이터 처리', '재시도가 성공하면 Synced로 복귀하고 경고가 해제된다', async () => {
    const app = await boot({ storageOpts: { failAll: true } });
    app.click('toggleBtn');
    assert(app.isVisible('storageErrorBanner'), 'precondition: 경고 표시');
    app.storage._state.failAll = false;            // 저장소 정상 복구
    app.click('resetBtn');                         // 다음 상태 변경 시점에 자동 재시도
    assert(!app.isVisible('storageErrorBanner'), '재시도 성공 후에도 경고가 해제되지 않음');
    assert(Object.keys(app.storage._dump()).length > 0, '재시도 시 실제 저장이 이뤄지지 않음');
    app.close();
  });

  await test('EC05-04', 'EC-05 최종 상태', '일부 키의 쓰기만 계속 실패하는 동안에는 경고가 유지되어야 한다', async () => {
    const app = await boot({ storageOpts: { failKeys: ['pomodoro_logs'] } });
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    app.click('memoSubmitBtn');                    // 로그 저장이 실패하는 상태 변경
    assert(app.storage._state.failedWrites.length > 0, 'precondition: 로그 키 쓰기 실패 발생');
    assert(app.storage.getItem('pomodoro_logs') === null, 'precondition: 로그가 저장되지 않음');
    assert(app.isVisible('storageErrorBanner'),
      '로그 키 쓰기가 계속 실패 중인데도 저장 실패 경고가 표시되지 않음 (다른 키의 쓰기 성공으로 경고가 해제됨)');
    app.close();
  });

  await test('EC05-05', 'EC-05 재시도 정책', '수동 재시도 UI 없이 사용자 조작이 차단되지 않는다', async () => {
    const app = await boot({ storageOpts: { failAll: true } });
    app.click('toggleBtn');
    app.click('skipBtn');
    eq(app.state.sessionType, 'shortBreak', '스킵 동작');
    app.click('resetBtn');
    eq(app.state.sessionState, 'idle', '리셋 동작');
    const banner = app.$('storageErrorBanner');
    eq(banner.querySelectorAll('button').length, 0, '경고 배너에 수동 재시도 버튼이 존재함');
    app.close();
  });
};

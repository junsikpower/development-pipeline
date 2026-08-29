/* Independent tests — Section 4 Functional Requirements (FR-01 ~ FR-06) */
const H = require('./harness');
const { createApp, suite, test, assert, eq } = H;

const MIN = 60 * 1000;

async function boot(cfg) { return createApp(Object.assign({ notification: 'granted' }, cfg || {})); }

/** Drive the app to a state where `n` focus slots are consumed via skipping. */
async function consumeSlotsBySkip(app, n) {
  for (let i = 0; i < n; i++) {
    // current session must be Focus
    eq(app.state.sessionType, 'focus', 'precondition: focus session');
    app.click('skipBtn');           // focus skipped -> break auto-started
    app.click('skipBtn');           // break skipped -> focus auto-started (unless long break)
  }
}

module.exports = async function run() {

  // =====================================================================
  suite('FR-01 타이머 시작/일시정지/리셋');

  await test('FR01-01', 'FR-01 Processing', '시작 시 endTimestamp = 현재시각 + 남은시간 으로 Running 전환', async () => {
    const app = await boot();
    const t0 = app.now();
    app.click('toggleBtn');
    eq(app.state.sessionState, 'running', 'session state');
    eq(app.state.endTimestamp, t0 + 25 * MIN, 'endTimestamp');
    app.close();
  });

  await test('FR01-02', 'FR-01 AC1', '시작 후 임의 시점의 표시 남은시간이 실제 경과시간과 일치', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(7 * MIN + 13000);
    eq(app.displayedRemaining(), '17:47', '7분13초 경과 후');
    app.advance(3 * MIN);
    eq(app.displayedRemaining(), '14:47', '추가 3분 경과 후');
    app.advance(14 * MIN + 46000);
    eq(app.displayedRemaining(), '00:01', '24분59초 경과 후');
    app.close();
  });

  await test('FR01-03', 'FR-01 AC2', '일시정지 시 표시된 남은시간이 변하지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(5 * MIN + 600);      // 임의 시점(초 경계 아님)에서 일시정지
    const before = app.displayedRemaining();
    app.click('toggleBtn');          // pause
    const after = app.displayedRemaining();
    eq(app.state.sessionState, 'paused', 'state');
    eq(after, before, `일시정지 전후 표시 남은시간 (전 ${before} / 후 ${after})`);
    app.close();
  });

  await test('FR01-04', 'FR-01 AC2', '일시정지 중에는 시간이 흐르지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(5 * MIN);
    app.click('toggleBtn');
    const snap = app.state.remainingSeconds;
    const shown = app.displayedRemaining();
    app.advanceSilently(45 * MIN);
    app.fireDue();
    eq(app.state.remainingSeconds, snap, '45분 경과 후 남은시간 스냅샷');
    eq(app.displayedRemaining(), shown, '45분 경과 후 표시');
    eq(app.state.sessionState, 'paused', '상태 유지');
    app.close();
  });

  await test('FR01-05', 'FR-01 AC2', '일시정지 후 재개하면 남은시간부터 이어서 진행', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(5 * MIN);
    app.click('toggleBtn');            // pause at 20:00
    app.advanceSilently(30 * MIN);
    app.click('toggleBtn');            // resume
    eq(app.state.sessionState, 'running', 'state');
    eq(app.displayedRemaining(), '20:00', '재개 직후 표시');
    app.advance(1 * MIN);
    eq(app.displayedRemaining(), '19:00', '재개 후 1분');
    app.close();
  });

  await test('FR01-06', 'FR-01 AC3', '리셋 시 설정된 세션 길이의 Idle 상태로 정확히 복귀', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(9 * MIN);
    app.click('resetBtn');
    eq(app.state.sessionState, 'idle', 'state');
    eq(app.state.remainingSeconds, 25 * 60, 'remainingSeconds');
    eq(app.displayedRemaining(), '25:00', 'display');
    eq(app.state.endTimestamp, null, 'endTimestamp cleared');
    app.close();
  });

  await test('FR01-07', 'FR-01 AC4 / BR-03', '3슬롯 소모 상태에서 4번째 Focus를 리셋해도 슬롯 수는 3 유지', async () => {
    const app = await boot();
    app.click('toggleBtn');
    await consumeSlotsBySkip(app, 3);
    eq(app.state.focusSlotsConsumed, 3, '슬롯 소모 수 (리셋 전)');
    eq(app.state.sessionType, 'focus', '4번째 Focus 진입');
    app.click('resetBtn');
    eq(app.state.focusSlotsConsumed, 3, '리셋 후 슬롯 소모 수');
    eq(app.state.sessionType, 'focus', '리셋 후 세션 타입');
    eq(app.state.sessionState, 'idle', '리셋 후 상태');
    app.close();
  });

  await test('FR01-08', 'FR-01 AC5 / BR-04', 'Memo-Input-Pending 상태에서 시작/일시정지/리셋 버튼 미노출', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    eq(app.state.sessionState, 'memoPending', '메모 대기 상태');
    assert(!app.isVisible('timerControls'), '타이머 제어 영역이 노출됨');
    assert(app.isVisible('memoCard'), '메모 카드가 노출되지 않음');
    app.close();
  });

  // =====================================================================
  suite('FR-02 세션 종료 알림 / EC-01');

  await test('FR02-01', 'FR-02 AC1', '세션 종료 시점에 지체 없이 알림 발생', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN - 1000);
    eq(app.notifLog.length, 0, '종료 전 알림 없음');
    app.advance(1000);
    await app.flush();
    eq(app.notifLog.length, 1, '종료 시점 알림 1건');
    app.close();
  });

  await test('FR02-02', 'FR-02 AC2', '권한 허용 시 소리 재생과 브라우저 알림이 함께 발생', async () => {
    const app = await boot({ notification: 'granted' });
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    assert(app.audioLog.oscillatorStarts > 0, '합성음 재생이 시도되지 않음');
    eq(app.notifLog.length, 1, 'Notification 호출 수');
    app.close();
  });

  await test('FR02-03', 'EC-01', '권한 거부 시 소리 + 탭 제목 변경으로 대체 (브라우저 알림 없음)', async () => {
    const app = await boot({ notification: 'denied' });
    const original = app.title();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    eq(app.notifLog.length, 0, '거부 상태인데 Notification이 발송됨');
    assert(app.audioLog.oscillatorStarts > 0, '소리 알림이 시도되지 않음');
    app.advance(900);
    assert(app.title() !== original, `탭 제목이 변경되지 않음 (title=${app.title()})`);
    app.close();
  });

  await test('FR02-04', 'EC-01', 'Notification API 미지원 시 소리 + 탭 제목 변경으로 대체', async () => {
    const app = await boot({ notification: null });
    const original = app.title();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    assert(app.audioLog.oscillatorStarts > 0, '소리 알림이 시도되지 않음');
    app.advance(900);
    assert(app.title() !== original, '탭 제목이 변경되지 않음');
    app.close();
  });

  await test('FR02-05', 'FR-02 AC3', '오디오 재생 실패(컨텍스트 생성 불가)가 감지되면 탭 제목 변경으로 대체', async () => {
    const app = await boot({ notification: 'granted', audio: { absent: true } });
    const original = app.title();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    app.advance(900);
    assert(app.title() !== original, '오디오 실패 시 탭 제목 폴백이 동작하지 않음');
    app.close();
  });

  await test('FR02-06', 'FR-02 AC3 / FR-02 Processing', '오디오 컨텍스트 resume 거부(자동재생 차단)도 재생 실패로 감지되어 탭 제목으로 대체', async () => {
    const app = await boot({
      notification: 'granted',
      audio: { initialState: 'suspended', resumeRejects: true }
    });
    const original = app.title();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    await app.flush();
    app.advance(900);
    const ctx = app.audioLog.contexts[0];
    assert(ctx && ctx.state === 'suspended', '전제: 오디오 컨텍스트가 suspended 상태여야 함');
    assert(app.title() !== original,
      `오디오가 실제로 재생되지 않았고(resume Promise 거부로 감지 가능) 폴백이 필요하나 탭 제목이 변경되지 않음 (title=${app.title()})`);
    app.close();
  });

  await test('FR02-07', 'FR-02 Trigger', '휴식 세션 종료 시에도 알림이 발생', async () => {
    const app = await boot({ notification: 'granted' });
    app.click('toggleBtn');
    app.click('skipBtn');                 // -> short break running
    eq(app.state.sessionType, 'shortBreak', 'precondition');
    const before = app.notifLog.length;
    app.advance(5 * MIN);
    await app.flush();
    assert(app.notifLog.length > before, '휴식 세션 종료 알림이 발생하지 않음');
    app.close();
  });

  await test('FR02-08', 'FR-02 Processing', '최초 사용자 상호작용(시작 클릭) 시점에 오디오 컨텍스트가 활성화된다', async () => {
    const app = await boot();
    eq(app.audioLog.contexts.length, 0, '시작 전에는 컨텍스트 없음');
    app.click('toggleBtn');
    assert(app.audioLog.contexts.length >= 1, '시작 클릭 시 오디오 컨텍스트가 생성되지 않음');
    app.close();
  });

  // =====================================================================
  suite('FR-03 뽀모도로 사이클 자동 전환');

  await test('FR03-01', 'FR-03 Processing', 'Focus 정상 종료 → 완료 카운트 +1 및 Memo-Input-Pending 전환', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    eq(app.state.sessionState, 'memoPending', '상태');
    const today = Object.keys(app.logs)[0];
    eq(app.logs[today].completedCount, 1, '완료 카운트');
    eq(app.state.focusSlotsConsumed, 1, '슬롯 소모');
    app.close();
  });

  await test('FR03-02', 'FR-03 Processing', 'Memo-Input-Pending 동안 다음 세션 타이머가 시작되지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    app.advance(20 * MIN);               // 사용자가 메모를 남기지 않고 방치
    eq(app.state.sessionState, 'memoPending', '여전히 메모 대기 상태여야 함');
    const today = Object.keys(app.logs)[0];
    eq(app.logs[today].completedCount, 1, '완료 카운트가 추가로 증가하면 안 됨');
    app.close();
  });

  await test('FR03-03', 'FR-03 AC2', '1번째 Focus 종료 + 메모 제출 → Short Break 자동 시작', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN);
    await app.flush();
    app.click('memoSubmitBtn');
    eq(app.state.sessionType, 'shortBreak', '다음 세션 타입');
    eq(app.state.sessionState, 'running', '자동 시작');
    eq(app.displayedRemaining(), '05:00', '표시 길이');
    app.close();
  });

  await test('FR03-04', 'FR-03 AC1', '4번째 Focus 슬롯 소모 직후에는 반드시 Long Break로 전환', async () => {
    const app = await boot();
    app.click('toggleBtn');
    for (let i = 1; i <= 4; i++) {
      app.advance(25 * MIN);
      await app.flush();
      eq(app.state.sessionState, 'memoPending', `${i}번째 Focus 완료`);
      app.click('memoSubmitBtn');
      if (i < 4) {
        eq(app.state.sessionType, 'shortBreak', `${i}번째 후 다음 세션`);
        app.advance(5 * MIN);            // break 종료 -> 다음 focus 자동 시작
        await app.flush();
        eq(app.state.sessionType, 'focus', `${i + 1}번째 Focus 자동 시작`);
        eq(app.state.sessionState, 'running', `${i + 1}번째 Focus 실행 중`);
      }
    }
    eq(app.state.sessionType, 'longBreak', '4번째 슬롯 소모 후 세션 타입');
    eq(app.state.sessionState, 'running', 'Long Break 자동 시작');
    eq(app.displayedRemaining(), '15:00', 'Long Break 길이');
    app.close();
  });

  await test('FR03-05', 'FR-03 AC3', 'Break 종료 후에는 메모 입력 없이 곧바로 다음 Focus가 시작', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.click('skipBtn');                 // -> short break running
    app.advance(5 * MIN);
    await app.flush();
    eq(app.state.sessionType, 'focus', '다음 세션 타입');
    eq(app.state.sessionState, 'running', '자동 시작');
    assert(!app.isVisible('memoCard'), 'Break 종료 후 메모 카드가 노출됨');
    app.close();
  });

  await test('FR03-06', 'BR-01', 'Long Break 정상 종료 → 사이클 초기화 후 Focus부터 재시작', async () => {
    const app = await boot();
    app.click('toggleBtn');
    await consumeSlotsBySkip(app, 3);     // 3슬롯 소모, 4번째 Focus running
    app.click('skipBtn');                 // 4번째 슬롯 소모 -> long break running
    eq(app.state.sessionType, 'longBreak', 'Long Break 진입');
    eq(app.state.focusSlotsConsumed, 4, '슬롯 4 소모');
    app.advance(15 * MIN);
    await app.flush();
    eq(app.state.sessionType, 'focus', 'Long Break 종료 후 세션 타입');
    eq(app.state.focusSlotsConsumed, 0, '사이클 초기화');
    eq(app.state.sessionState, 'running', '자동 시작');
    app.close();
  });

  // =====================================================================
  suite('FR-04 세션 건너뛰기 (Skip)');

  await test('FR04-01', 'FR-04 AC1', 'Focus 스킵 시 완료 개수가 변하지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.click('skipBtn');
    eq(Object.keys(app.logs).length, 0, '스킵으로 로그가 생성되면 안 됨');
    eq(app.text('logCompletedCount'), '0개', '로그 화면 완료 개수');
    app.close();
  });

  await test('FR04-02', 'FR-04 Processing', 'Focus 스킵 시 메모 입력을 요구하지 않고 슬롯은 소모된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.click('skipBtn');
    assert(!app.isVisible('memoCard'), '스킵 후 메모 카드가 노출됨');
    eq(app.state.focusSlotsConsumed, 1, '슬롯 소모');
    eq(app.state.sessionType, 'shortBreak', '다음 세션');
    eq(app.state.sessionState, 'running', '자동 시작');
    app.close();
  });

  await test('FR04-03', 'FR-04 AC2', 'Focus 2회 스킵 + 2회 정상완료 → 슬롯 4 소모로 Long Break, 완료 카운트는 2', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.click('skipBtn');                 // slot1 skip -> SB
    app.click('skipBtn');                 // SB skip -> focus
    app.click('skipBtn');                 // slot2 skip -> SB
    app.click('skipBtn');                 // SB skip -> focus
    app.advance(25 * MIN); await app.flush();   // slot3 complete
    app.click('memoSubmitBtn');           // -> SB running
    app.click('skipBtn');                 // SB skip -> focus
    app.advance(25 * MIN); await app.flush();   // slot4 complete
    eq(app.state.focusSlotsConsumed, 4, '슬롯 소모 수');
    app.click('memoSubmitBtn');
    eq(app.state.sessionType, 'longBreak', '4슬롯 소모 후 Long Break');
    const today = Object.keys(app.logs)[0];
    eq(app.logs[today].completedCount, 2, '완료 카운트');
    app.close();
  });

  await test('FR04-04', 'FR-04 AC3 / BR-04', 'Memo-Input-Pending 상태에서 스킵 버튼 미노출', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    const skipBtn = app.$('skipBtn');
    const controls = app.$('timerControls');
    assert(controls.style.display === 'none' || skipBtn.style.display === 'none',
      '메모 대기 상태에서 스킵 버튼이 노출됨');
    app.close();
  });

  await test('FR04-05', 'BR-01', 'Long Break 스킵 시에도 사이클이 초기화되어 Focus부터 재시작', async () => {
    const app = await boot();
    app.click('toggleBtn');
    await consumeSlotsBySkip(app, 3);
    app.click('skipBtn');                 // -> long break
    eq(app.state.sessionType, 'longBreak', 'precondition');
    app.click('skipBtn');                 // long break skip
    eq(app.state.sessionType, 'focus', '세션 타입');
    eq(app.state.focusSlotsConsumed, 0, '사이클 초기화');
    eq(app.state.sessionState, 'running', '자동 시작');
    app.close();
  });

  await test('FR04-06', 'BR-01', 'Short Break 스킵은 Focus 슬롯을 소모하지 않는다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.click('skipBtn');                 // focus skip -> slot 1
    const before = app.state.focusSlotsConsumed;
    app.click('skipBtn');                 // short break skip
    eq(app.state.focusSlotsConsumed, before, '휴식 스킵으로 슬롯이 소모됨');
    app.close();
  });

  // =====================================================================
  suite('FR-05 작업 메모 기록');

  await test('FR05-01', 'FR-05 AC1', 'Focus 정상 종료 시마다 메모 입력 창이 표시된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    for (let i = 0; i < 2; i++) {
      app.advance(25 * MIN); await app.flush();
      assert(app.isVisible('memoCard'), `${i + 1}회차 메모 입력 창 미표시`);
      app.click('memoSubmitBtn');
      app.advance(5 * MIN); await app.flush();  // break -> next focus auto
    }
    app.close();
  });

  await test('FR05-02', 'FR-05 AC2', '빈 값 제출 시에도 완료 카운트는 정상 증가하고 메모는 빈 값으로 저장', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    app.setInput('memoInput', '');
    app.click('memoSubmitBtn');
    const today = Object.keys(app.logs)[0];
    eq(app.logs[today].completedCount, 1, '완료 카운트');
    eq(app.logs[today].memos.length, 1, '메모 항목 수');
    eq(app.logs[today].memos[0].memo, '', '메모 텍스트');
    app.close();
  });

  await test('FR05-03', 'FR-05 AC2', '건너뛰기 시에도 완료 카운트는 정상 증가하고 메모는 빈 값으로 저장', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    app.setInput('memoInput', '입력했지만 건너뛰기');
    app.click('memoSkipBtn');
    const today = Object.keys(app.logs)[0];
    eq(app.logs[today].completedCount, 1, '완료 카운트');
    eq(app.logs[today].memos[0].memo, '', '건너뛰기 시 메모는 빈 값이어야 함');
    app.close();
  });

  await test('FR05-04', 'FR-05 Processing', '입력한 메모가 완료 시각과 함께 해당 날짜 로그에 저장된다', async () => {
    const app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    app.setInput('memoInput', 'PRD 분석');
    app.click('memoSubmitBtn');
    eq(app.logs['2026-03-10'].memos[0].memo, 'PRD 분석', '메모 텍스트');
    eq(app.logs['2026-03-10'].memos[0].time, '09:25', '완료 시각');
    app.close();
  });

  await test('FR05-05', 'FR-05 Processing', '공백만 입력한 메모는 빈 값으로 저장된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    app.setInput('memoInput', '     ');
    app.click('memoSubmitBtn');
    const today = Object.keys(app.logs)[0];
    eq(app.logs[today].memos[0].memo, '', '공백 메모');
    app.close();
  });

  await test('FR05-06', 'FR-05 Processing / BR-04', '메모 대기 상태는 제출 또는 건너뛰기로만 벗어난다(취소 동작 없음)', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    const buttons = Array.from(app.$('memoCard').querySelectorAll('button'))
      .map(b => b.textContent.trim());
    eq(buttons.length, 2, `메모 카드 버튼 수 (${buttons.join(' / ')})`);
    assert(!buttons.some(b => /취소|cancel/i.test(b)), `취소 동작이 존재함: ${buttons.join(' / ')}`);
    app.close();
  });

  // =====================================================================
  suite('FR-06 일별 로그 화면');

  await test('FR06-01', 'FR-06 AC1', '표시 완료 개수 = 해당 날짜 정상 종료 Focus 세션 수 (스킵 제외)', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush(); app.click('memoSubmitBtn');  // complete 1
    app.click('skipBtn');                                                   // skip break -> focus
    app.click('skipBtn');                                                   // skip focus (slot, no count)
    app.click('skipBtn');                                                   // skip break -> focus
    app.advance(25 * MIN); await app.flush(); app.click('memoSubmitBtn');  // complete 2
    app.clickTab('logTab');
    eq(app.text('logCompletedCount'), '2개', '로그 화면 완료 개수');
    app.close();
  });

  await test('FR06-02', 'FR-06 AC2', '메모가 오래된 순(오름차순)으로 표시된다', async () => {
    const app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    app.click('toggleBtn');
    const expected = [];
    for (let i = 1; i <= 3; i++) {
      app.advance(25 * MIN); await app.flush();
      app.setInput('memoInput', `작업 ${i}`);
      app.click('memoSubmitBtn');
      expected.push(`작업 ${i}`);
      app.advance(5 * MIN); await app.flush();
    }
    app.clickTab('logTab');
    const rows = Array.from(app.$('logList').querySelectorAll('.log-item'));
    eq(rows.length, 3, '로그 행 수');
    const times = rows.map(r => r.querySelector('.log-time').textContent.trim());
    const memos = rows.map(r => r.querySelector('.log-memo').textContent.trim());
    eq(memos, expected, '메모 순서');
    const sorted = times.slice().sort();
    eq(times, sorted, `시각 오름차순 (${times.join(', ')})`);
    app.close();
  });

  await test('FR06-03', 'FR-06 Output / FR-05 Output', '빈 메모는 "메모 없음"으로 표시된다', async () => {
    const app = await boot();
    app.click('toggleBtn');
    app.advance(25 * MIN); await app.flush();
    app.click('memoSkipBtn');
    app.clickTab('logTab');
    const row = app.$('logList').querySelector('.log-item');
    assert(row, '로그 행이 생성되지 않음');
    eq(row.querySelector('.log-memo').textContent.trim(), '메모 없음', '빈 메모 표시');
    app.close();
  });

  await test('FR06-04', 'FR-06 Processing', '기본 선택 날짜는 오늘(로컬 타임존)이다', async () => {
    const app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime() });
    eq(app.$('logDatePicker').value, '2026-03-10', '기본 날짜');
    app.close();
  });

  await test('FR06-05', 'FR-06 Processing', '다른 날짜 선택 시 해당 날짜의 데이터가 표시된다', async () => {
    const seed = {
      pomodoro_logs: JSON.stringify({
        '2026-03-08': { completedCount: 3, memos: [{ time: '10:00', memo: '어제 작업' }] },
        '2026-03-10': { completedCount: 1, memos: [{ time: '09:25', memo: '오늘 작업' }] }
      })
    };
    const app = await boot({ startTime: new Date(2026, 2, 10, 9, 0, 0).getTime(), storage: seed });
    app.clickTab('logTab');
    eq(app.text('logCompletedCount'), '1개', '오늘 완료 개수');
    app.setInput('logDatePicker', '2026-03-08');
    app.$('logDatePicker').dispatchEvent(new app.window.Event('change'));
    eq(app.text('logCompletedCount'), '3개', '선택 날짜 완료 개수');
    eq(app.$('logList').querySelector('.log-memo').textContent.trim(), '어제 작업', '선택 날짜 메모');
    app.close();
  });

  await test('FR06-06', 'FR-06 Expected State', '기록이 없는 날짜는 0개 + 빈 목록 안내가 표시된다', async () => {
    const app = await boot();
    app.clickTab('logTab');
    eq(app.text('logCompletedCount'), '0개', '완료 개수');
    assert(app.isVisible('logEmptyMsg'), '빈 목록 안내가 표시되지 않음');
    app.close();
  });
};

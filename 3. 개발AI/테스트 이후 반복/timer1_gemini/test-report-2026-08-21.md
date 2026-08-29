# 독립 테스트 리포트 — 뽀모도로 타이머 (gemini포모도로.html)

- **대상 코드**: `gemini포모도로.html` (1,757줄, 최종 수정 2026-08-19 23:28)
- **기준 명세**: `pomodoro-timer-PRD-v4.md` (v4 Final)
- **수행 기준**: `AGENTS.md`
- **수행일**: 2026-08-21
- **최종 판정**: **false (구현실패)** — 설계·실행한 75개 케이스 중 **69 PASS / 6 FAIL**

> 본 테스트는 PRD 명세만을 기준으로 독립 설계했으며, 개발 AI가 작성한 `test-runner.js`는 **실행하지 않았고 참조하지도 않았다**. 애플리케이션 코드는 일절 수정하지 않았다.

---

## 1. 독립 테스트 설계

### 1.1 테스트 환경(하네스) 설계

`file://` 단일 HTML + `localStorage` + 절대시각 기반 타이머라는 특성상, 시간 경과·재접속·저장 실패를 재현하려면 시간과 저장소를 통제할 수 있는 실행 환경이 필요하다. 두 계층으로 구성했다.

| 계층 | 도구 | 통제 대상 | 검증 목적 |
|---|---|---|---|
| A. 결정론적 하네스 | Node 24 + jsdom 29 (`harness.js`) | `Date.now()`, `performance.now()`, `setInterval/setTimeout`, `localStorage`, `document.hidden`, `Notification`, `AudioContext` | 시간 경과·다중 세션 만료·시계 변경·저장 실패 등 상태 전이 전반 |
| B. 실제 브라우저 | Chrome 헤드리스 + CDP (`browser.js`) | 실제 `file://` 실행, 실제 시간, 브라우저 네이티브 폼 검증 | 환경 의존 항목(부팅, file:// localStorage, 입력 제약, 실시간 카운트다운) |

- 앱은 `window.app`으로만 접근하고, 조작은 **실제 DOM 이벤트(click/submit/change)** 로 수행하여 내부 함수 직접 호출에 의존하지 않았다.
- 시간 통제: `advance(ms)`(두 시계 동시 진행 + 타이머 발화), `advanceFrozen(ms)`(백그라운드 스로틀링: 시간만 진행, tick 미발화), `jumpSystemClock(ms)`(Date만 점프 = 시스템 시계 변경), 앱 재기동(`launchApp` 재호출 + 저장소 Map 승계 = 새로고침/재시작).

### 1.2 PRD 기반 설계 (AGENTS.md 1~10)

1. **§4 Functional Requirements**: FR-01~FR-08 각각의 Input/Processing/Output/Expected State/Acceptance Criteria를 케이스로 분해 (TC-FR01-\* ~ TC-FR08-\*).
2. **§8 Error & Edge Cases**: EC-01~EC-05의 발생 조건·시스템 상태 전이·사용자 표시·데이터 처리·복구 정책을 각각 Negative 케이스로 도출 (TC-EC02-\*, TC-EC04-\*, TC-EC05-\*, EC-01은 TC-FR02-03/05, EC-03은 TC-FR08-02/03/04/07·TC-SYS-02/03).
3. **§10 Non-Functional**: NFR-01(3시간 연속 구동 드리프트 실측), NFR-02/03(외부 리소스 0건·단일 파일 자체 완결성 실측 및 실브라우저 file:// 부팅).
4. **§13.1 Functional / §13.2 System**: 13.1은 기능 단위(FR 케이스), 13.2는 통합 시나리오(TC-SYS-01 정상 흐름 / TC-SYS-02 Running 복원 / TC-SYS-03 Paused 복원 / TC-SYS-04 오프라인 단일 파일).
5. **§13.3 User**: 5개 조항마다 시나리오 1개 이상(TC-USER-01~05), 각 시나리오에 조작 간 시간 경과(메모 작성 8~20초, 일시정지 30초, 탭 비활성 60분, 재접속 1~26시간 등)를 포함.
6. **§3.2 Out of Scope / §12.1 Technical Constraints**: 제외 기능 미포함 및 제약 준수 검증(TC-CONS-01~03, TC-NFR02-01, TC-NFR03-01).
7. **§8·§10의 "없음" 항목**: 해당 없음(PRD에 "없음" 기재 항목 없음).
8. 개발 AI의 내부 로직/자체 테스트를 참조하지 않고, 입·출력과 저장 데이터(localStorage 3개 키) 및 화면 상태만으로 검증.
9. 비즈니스 규칙 BR-01~BR-04를 별도 검증 축으로 편성.
10. **모든 케이스에 기대값의 근거 PRD 조항을 명기**했고, 근거 조항을 특정할 수 없는 기대값(예: 손상된 저장 데이터 복구 정책)은 테스트로 채택하지 않고 §5 참고 사항으로만 기록했다.

### 1.3 코드 기반 설계 (AGENTS.md 최신 커밋 코드 기반 1~7)

- 저장소가 git 저장소가 아니어서 `git diff` 확보가 불가하므로, **가장 최근 수정된 산출물 파일 전체**(`gemini포모도로.html`, 2026-08-19 23:28)를 1차 분석 대상으로 삼았다.
- 이 파일은 단일 파일 구조이므로 내부 모듈(StorageManager / SoundSynthesizer / NotificationManager / PomodoroEngine)과 **공유 전역 상태인 localStorage 3개 키**(`pomodoro_settings`, `pomodoro_logs`, `pomodoro_timer_state`)를 회귀 영향 범위로 설정했다.
- 분기·경계·예외 경로를 겨냥한 케이스: 슬롯 소모 순환(`% 4`), 복원 분기(Running 만료 / Running 진행 중 / Paused / Idle / Memo-Pending), 시계 이상 임계값 경계(4.9초 / 5.1초), Paused 스냅샷 최소값, 비동기 알림 실패 전파(`play()` 거부), 저장 예외 처리.
- `12.3 Implementation Freedom` 대상(명명·구조·CSS·오디오 활성화 방식 등)은 선택 자체를 결함으로 판정하지 않고, **실제 오동작·모순으로 증명 가능한 경우에만** 결함으로 보고했다.
- 결함 발견 시 코드는 수정하지 않고 재현·증명하는 독립 테스트만 작성했다(TC-FR08-03/04/08/09).

---

## 2. 테스트 수행 결과

| 스위트 | 파일 | 케이스 | PASS | FAIL | 미실행 |
|---|---|---:|---:|---:|---:|
| 기능(FR/BR) | `t_fr.js` | 43 | 38 | 5 | 0 |
| 예외·비기능·제약 | `t_ec.js` | 19 | 19 | 0 | 0 |
| 통합·사용자 시나리오 | `t_sys.js` | 9 | 8 | 1 | 0 |
| 실제 브라우저(file://) | `browser.js` | 4 | 4 | 0 | 0 |
| **합계** | | **75** | **69** | **6** | **0** |

설계한 케이스는 전부 실행되었으며 미실행 케이스는 없다. 다만 아래 §4에 **테스트로 채택하지 않아 미검증으로 남은 조항**을 명시한다.

### 2.1 PRD 조항 ↔ 테스트 케이스 대응

| PRD 조항 | 대응 테스트 케이스 | 결과 |
|---|---|---|
| FR-01 시작/일시정지/리셋 | TC-FR01-01, -02, -03, -04, -05, TC-BR-04 | PASS |
| FR-02 세션 종료 알림 | TC-FR02-01, -02, -03, -04, -05 | PASS |
| FR-03 사이클 자동 전환 | TC-FR03-02, -03, -04, -05 | PASS |
| FR-03 Processing (1) 완료 카운트 증가 시점 | **TC-FR03-01** | **FAIL (DEF-04)** |
| FR-04 세션 건너뛰기 | TC-FR04-01, -02, -03, -04, -05 | PASS |
| FR-05 작업 메모 기록 | TC-FR05-01, -02, -03 | PASS |
| FR-06 일별 로그 화면 | TC-FR06-01, -02, -03, -04 | PASS |
| FR-07 설정 커스터마이징 | TC-FR07-01, -02, -03, -04, -05, -06, TC-BR-03 | PASS |
| FR-08 영속성/복원 (Running 진행 중·Paused·슬롯·Memo-Pending) | TC-FR08-01, -02, -05, -06, -07, TC-BR-02 | PASS |
| FR-08 Processing/AC2 (만료 세션 1회 종료 처리) | **TC-FR08-03, TC-SYS-02** | **FAIL (DEF-01)** |
| FR-08 Processing (로그 귀속 날짜 = endTimestamp 기준) | **TC-FR08-04** | **FAIL (DEF-02)** |
| FR-08 AC3 (복원 후 다음 세션 Idle 대기) | **TC-FR08-08, TC-FR08-09** | **FAIL (DEF-03)** |
| BR-01 세션 순서·완료 카운트 | TC-FR03-03, -05, TC-FR04-02, -04, TC-SYS-01 | PASS |
| BR-02 자동 시작 적용 범위 | TC-FR08-07 (Break 만료) | PASS |
| BR-02 (Focus 만료 복원 경로) | **TC-FR08-08, -09, TC-SYS-02** | **FAIL (DEF-03)** |
| BR-03 리셋과 슬롯 독립성 | TC-FR01-04 | PASS |
| BR-04 Memo-Pending 조작 제한 | TC-FR01-05, TC-FR04-03, TC-FR08-06 | PASS |
| §6.1/6.2 상태 정의(Memo-Pending 기저 Idle) | TC-FR03-01(부분), TC-FR01-05 | PASS(해당 항목) |
| §6.3 TimerState(endTimestamp/Paused 스냅샷) | TC-CONS-02, TC-DM-01 | PASS |
| §6.3 DailyLog(로컬 타임존) | TC-FR06-04 | PASS |
| §7.2 저장 키 분리 | TC-CONS-03, TC-BR-02 | PASS |
| §7.5 앱 내 삭제 기능 부재 | TC-CONS-01 | PASS |
| EC-01 알림 권한 거부/미지원 | TC-FR02-03, TC-FR02-05 | PASS |
| EC-02 백그라운드 중 세션 종료 | TC-EC02-01, TC-EC02-02 | PASS |
| EC-03 재시작 복원(Paused / Break 만료) | TC-FR08-02, -07, TC-SYS-03 | PASS |
| EC-03 재시작 복원(Focus 만료) | **TC-FR08-03, -04, TC-SYS-02** | **FAIL (DEF-01/02/03)** |
| EC-04 시스템 시계 변경 | TC-EC04-01, -02, -03, -04, -05, -06, TC-USER-04 | PASS |
| EC-05 localStorage 쓰기 실패 | TC-EC05-01, -02, -03, TC-USER-05 | PASS |
| NFR-01 타이머 정확도 | TC-NFR01-01(3시간 무드리프트), TC-NFR01-02, TC-USER-03, TC-BR-04 | PASS |
| NFR-02 오프라인 가용성 | TC-NFR02-01, TC-SYS-04, TC-BR-01 | PASS |
| NFR-03 이식성(단일 파일) | TC-NFR03-01, TC-BR-01 | PASS |
| §12.1 기술 제약 | TC-NFR02-01, TC-NFR03-01, TC-CONS-01, TC-BR-01 | PASS |
| §12.2 승인된 기술 결정 | TC-CONS-02(절대시각), TC-EC04-06(델타 비교/5초), TC-EC02-01(visibilitychange), TC-CONS-03(키 분리) | PASS |
| §3.2 Out of Scope | TC-CONS-01 | PASS |
| §13.1 Functional Acceptance | 위 FR/BR 케이스 전체 | 일부 FAIL |
| §13.2 System — 정상 실행 중 | TC-SYS-01 | PASS |
| §13.2 System — 재접속 복원(Running) | **TC-SYS-02** | **FAIL** |
| §13.2 System — 재접속 복원(Paused) | TC-SYS-03 | PASS |
| §13.2 System — 오프라인 단일 파일 | TC-SYS-04, TC-BR-01 | PASS |
| §13.3 (1) 하루 사용 로그 일치 | TC-USER-01 | PASS |
| §13.3 (2) 새로고침/재시작 유지 | TC-USER-02 | PASS |
| §13.3 (3) 수 시간 정확도 | TC-USER-03 | PASS |
| §13.3 (4) 시계 변경 시 일시정지·확인 | TC-USER-04 | PASS |
| §13.3 (5) 저장 실패 인지 | TC-USER-05 | PASS |
| §1.3 지원 브라우저(Edge/Firefox 실기기) | — | **미검증** (§4 참고) |
| §7.4 Retention(보존 기간) | — | **미검증** (§4 참고) |

---

## 3. 결함 상세

### DEF-01 (Critical) — 오프라인 중 만료된 Focus 세션이 완료 2회로 이중 기록됨

- **위반 조항**: FR-08 Processing/AC2("경과한 세션 수와 무관하게 '중단 시점의 세션 1회만' 종료 처리"), EC-03 데이터 처리, BR-01("완료 개수는 정상 종료된 Focus 세션에 대해서만 1씩 증가"), §13.2 재접속 복원 시나리오
- **결함 위치**: `gemini포모도로.html:1239` (`restoreState()` 내부 `this.recordCompletedFocus(originalEndTimestamp, '')`) + `:1393` (`submitMemo()`) / `:1399` (`skipMemo()`)
- **재현 조건**: 설정 25/5/15 → Focus 시작(Running) → 앱 종료 → 3시간 뒤 재접속 → 복원되어 표시된 메모 입력창에 `오프라인 중 완료` 제출
- **기대 동작**: 해당 날짜 완료 카운트 **1**, 메모 항목 1건
- **실제 동작**: 완료 카운트 **2**
  `{"2026-08-21":{"count":2,"items":[{"time":"09:25:00","memo":""},{"time":"12:00:00","memo":"오프라인 중 완료"}]}}`
- **원인(코드 분석)**: 복원 시점에 이미 완료 기록을 1건 쓰고(1239행) `isMemoPending = true`로 전환하는데, 메모 제출/건너뛰기 경로(1393/1399행)가 그와 무관하게 `recordCompletedFocus()`를 다시 호출한다.
- **검출 케이스**: **TC-FR08-03**, **TC-SYS-02**

### DEF-02 (Major) — 만료 세션의 메모가 원래 종료 목표 시각 날짜가 아닌 "현재 날짜"에 별도 기록됨

- **위반 조항**: FR-08 Processing("완료 처리된 세션의 로그 귀속 날짜는 원래의 종료 목표 시각(endTimestamp) 기준 날짜로 기록"), EC-03 데이터 처리, FR-06 AC1
- **결함 위치**: `gemini포모도로.html:1393`, `:1399` (`recordCompletedFocus(Date.now(), ...)`)
- **재현 조건**: 2026-08-20 23:00에 25분 Focus 시작(종료 목표 08-20 23:25) → 앱 종료 → 2026-08-21 09:00 재접속 → 메모 `심야 작업` 제출
- **기대 동작**: `2026-08-20`에 완료 1건, 메모 `심야 작업`
- **실제 동작**: `2026-08-20`에 완료 1건(메모 `''`) + `2026-08-21`에 완료 1건(메모 `심야 작업`) — 날짜 귀속 오류이자 완료 기록과 사용자 메모의 분리
  `{"2026-08-20":{"count":1,...,"memo":""},"2026-08-21":{"count":1,...,"memo":"심야 작업"}}`
- **검출 케이스**: **TC-FR08-04**

### DEF-03 (Major) — 재접속 복원 흐름에서 다음 세션이 자동 시작됨 (Idle 대기 위반)

- **위반 조항**: BR-02("재접속으로 복원된 만료 세션은 자동 시작하지 않고 Idle로 대기"), EC-03 최종 상태, FR-08 AC3("복원 후 다음 세션은 자동으로 시작되지 않고 Idle 상태로 대기하며 사용자의 시작 조작을 필요로 한다"), §2.3, §12.2 자동 시작 범위
- **결함 위치**: `gemini포모도로.html:1403-1412` (`finishMemoAndProceed()` 말미의 `this.start()`) — 복원에서 진입한 Memo-Pending인지 실시간 사용 중 진입인지 구분하지 않음
- **재현 조건 A**: 25분 Focus Running 상태로 앱 종료 → 90분 뒤 재접속(메모 대기 복원) → 10초 뒤 `건너뛰기` 클릭
- **재현 조건 B**: Focus 정상 종료로 Memo-Pending 상태 저장 → 2시간 뒤 재접속 → 메모 제출
- **기대 동작**: 다음 세션(ShortBreak)이 `Idle`, `endTimestamp = null` 상태로 대기 → 사용자가 직접 시작
- **실제 동작**: 두 경우 모두 `sessionStatus = "Running"`, ShortBreak 05:00 카운트다운 자동 시작
- **검출 케이스**: **TC-FR08-08**, **TC-FR08-09**, **TC-SYS-02**

### DEF-04 (Minor, 기획 확인 필요) — Focus 정상 종료 시점에 완료 카운트가 즉시 증가하지 않음

- **위반 조항(해석)**: FR-03 Processing "(1) 완료 카운트를 1 증가 → (2) `Memo-Input-Pending`으로 전환" 순서, FR-06 AC1("표시되는 완료 개수가 해당 날짜에 정상 종료된 Focus 세션 수와 정확히 일치")
- **결함 위치**: `gemini포모도로.html:1361-1375` (`onSessionComplete()`의 Focus 분기에 완료 기록 없음), 실제 기록은 `:1390-1400`(메모 제출/건너뛰기 시점)
- **재현 조건**: Focus 세션을 시간 만료로 정상 종료시킨 뒤, 메모를 제출하지 않은 상태에서 기록 화면 확인
- **기대 동작**: 완료 개수 1 (해당 Focus는 이미 정상 종료됨)
- **실제 동작**: 완료 개수 0 (메모 제출/건너뛰기 후에야 1로 증가)
- **참고**: §12.3은 "완료 카운트·슬롯 소모의 저장 순서 등 세부 알고리즘"을 Development AI 자율로 두고 있어, 이를 "저장 순서의 자율"로 볼 여지가 있다. 반면 FR-03은 증가 시점을 명시적 순번으로 기술한다. **기획 판단이 필요한 항목**으로 분류한다.
- **검출 케이스**: **TC-FR03-01**

---

## 4. 미검증 항목 (통과로 보고하지 않음)

| 항목 | 사유 |
|---|---|
| §1.3 Edge·Firefox 실기기 동작 | 실브라우저 검증은 Chrome(헤드리스, `file://`)로만 수행. jsdom + 정적 검증으로 대체했으나 Edge/Firefox 실측은 미실행 |
| §7.4 Retention(만료 기한 없이 보존) | 브라우저 저장소 수명에 의존하는 항목으로, 재현 가능한 판정 기준을 PRD에서 특정할 수 없어 케이스 미채택 |
| §3.2 OS/브라우저 설정에 의한 알림 미표시 | PRD가 감지·보정 대상에서 명시적으로 제외 — 설계 대상 아님 |
| 실제 저장 공간 초과(Quota) 물리적 재현 | `localStorage.setItem` 예외 주입(Mock)으로 EC-05 경로를 검증. 실제 디스크 초과 상황은 미재현 |

## 5. 참고 관찰 사항 (결함 미판정)

- **OB-01 — 슬롯 카운트 순환 저장**: `consumeFocusSlot()`이 `(n+1) % 4`로 저장하여 §6.3의 "사이클 내 소모된 Focus 슬롯 수(0~4)" 중 값 `4` 상태가 존재하지 않는다. Long Break 진행 중 사이클 진행 인디케이터가 0개로 표시되지만, BR-01의 전환 동작 자체는 정상(TC-FR03-03/05, TC-FR04-02/04 PASS)이므로 §12.3에 따라 결함으로 판정하지 않았다.
- **OB-02 — 백그라운드 중 시계 변경**: 탭 비활성 중 발생한 시스템 시계 변경은 탭 복귀 시 앵커가 재샘플링되어 감지되지 않는다. EC-04는 "탭 복귀도 확인 시점"이라고 하면서 동시에 "탭 복귀 시 앵커 재설정으로 절전·동결에 의한 오탐지를 방지"한다고 규정하여 두 요구가 상호 배타적이다. 명세 모호성으로 판단해 결함으로 판정하지 않았으며, 구현은 오탐지 방지 쪽을 택했다(TC-EC04-05 PASS).
- **OB-03 — 설정 입력 검증의 의존성**: 소수·범위 밖 입력의 차단은 브라우저 네이티브 제약(`type=number, min=1, max=180, step=1, required`)에 의존한다. 실제 Chrome에서는 `checkValidity()=false`로 제출 자체가 차단되어 저장되지 않음을 확인했으나(TC-BR-03 PASS), 스크립트 단독(`parseInt`)으로는 `30.7` → `30` 절삭이 가능하다. 지원 브라우저 범위 내에서는 PRD 요건을 충족하므로 결함 아님.
- **OB-04 — 손상된 저장 데이터**: 외부 요인으로 `pomodoro_logs`에 `"null"` 문자열이 저장되면 `renderLogView()`(768행 부근)에서 `TypeError`가 발생한다. 앱 자체 경로로는 발생 불가하고 PRD에 관련 요구가 없어 테스트로 채택하지 않았다(파싱 불가 문자열은 정상 복구됨 — TC-ROB-01 PASS).

---

## 6. true 여부에 따른 분기점

- **판정: false** — 통과하지 못한 케이스 6건 존재 (TC-FR03-01, TC-FR08-03, TC-FR08-04, TC-FR08-08, TC-FR08-09, TC-SYS-02)
- **유형 분류: 2. 구현 실패** — 빌드·실행 자체는 정상이다(실제 Chrome `file://` 부팅·카운트다운·저장 모두 정상, 콘솔 에러 0건 — TC-BR-01~04 PASS). 실행은 되나 재접속 복원 경로(FR-08 / EC-03 / BR-02)의 동작이 PRD와 다르다.
  - 단, **DEF-04는 FR-03 Processing과 §12.3 Implementation Freedom 간 해석 충돌** 소지가 있어 기획 확인이 필요한 항목으로 함께 표시한다.
- **후속 조치**: 본 리포트를 개발 AI로 전송한다. (AGENTS.md의 전송 절차는 현재 주석 처리되어 확정되지 않았으므로, 실제 전송 경로는 사용자 지시에 따른다.)

---

## 7. 재현 방법

독립 테스트 자산 위치(세션 스크래치패드):
`%LOCALAPPDATA%\Temp\claude\C--Users-YUNJUNSIK-Desktop-development-timer1-gemini\59c94f47-1291-4c9f-8b2a-787e1a09842d\scratchpad\`

```
harness.js    # jsdom 하네스(가상 시계/저장소/알림/오디오 주입)
helpers.js    # 공통 조작 헬퍼
framework.js  # 테스트 러너
t_fr.js       # FR-01~FR-08, BR-01~BR-04 (43)
t_ec.js       # EC-02/04/05, NFR-01~03, 제약·데이터 모델 (19)
t_sys.js      # 13.2 System / 13.3 User 시나리오 (9)
browser.js    # 실제 Chrome(file://) 검증 (4)
```

```bash
npm install jsdom
node run.js t_fr,t_ec,t_sys   # 71 케이스
node browser.js               # 4 케이스 (Chrome 헤드리스)
```

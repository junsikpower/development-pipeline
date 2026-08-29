/// 실행 완료 체크 및 달성률 표시 — FR-14 (3), BR-09.
library;

/// 날짜별 달성률 = 완료된 논리 블럭 수 / 그 날 링에 표시되는 논리 블럭 수.
///
/// 모집단에는 대표가 그 날짜인 블럭과 전날에서 이월된 블럭이 모두 포함된다.
/// 즉 자정 교차 논리 블럭 1개는 D일과 D+1일 모집단에 각각 1개씩 집계된다
/// (BR-05). 이는 호출자가 [totalCount]/[completedCount]를 셀 때 이미 반영해야
/// 하는 규칙이며, 이 함수는 나눗셈만 담당한다.
///
/// 모집단이 0개이면 달성률은 정의되지 않는다(null). 도트를 표시하지 않는다.
double? computeAchievementRate(int completedCount, int totalCount) {
  if (totalCount <= 0) return null;
  return completedCount / totalCount;
}

/// 캘린더 도트의 불투명도 = 0.3 + 0.7 * 달성률 (BR-09, 선형 변환).
/// 0% -> 0.30, 50% -> 0.65, 100% -> 1.00.
double dotOpacityFor(double achievementRate) => 0.3 + 0.7 * achievementRate;

/// [totalCount]가 0이면 도트를 표시하지 않으므로 불투명도가 정의되지 않는다.
double? dotOpacityForCounts(int completedCount, int totalCount) {
  final double? rate = computeAchievementRate(completedCount, totalCount);
  return rate == null ? null : dotOpacityFor(rate);
}

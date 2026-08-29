/// 단일 점유 규칙과 겹침 검증 (BR-02, FR-08).
///
/// 검증은 날짜별 인스턴스 구간 단위로 수행한다. 모든 인스턴스가
/// `startMinute + durationMinutes <= 1440`을 만족하므로, 날짜별 구간 비교만으로
/// 링크 블럭을 포함한 전체 겹침을 완전히 검증할 수 있다(NFR-04).
library;

import 'models.dart';
import 'plan_date.dart';

/// 두 반개구간 `[aStart, aEnd)`, `[bStart, bEnd)`가 교집합을 갖는지 판정한다.
///
/// 경계 시각 공유(A 종료 == B 시작)는 겹침이 아니다(BR-02).
bool intervalsOverlap(int aStart, int aEnd, int bStart, int bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/// 동일 날짜의 두 인스턴스가 겹치는지 판정한다.
///
/// 날짜가 다르면 항상 false이다. 인스턴스는 자기 날짜 안에서 완결되므로
/// 날짜가 다른 두 인스턴스는 시간적으로도 교차할 수 없다.
bool instancesOverlap(BlockInstance a, BlockInstance b) {
  if (a.date != b.date) return false;
  return intervalsOverlap(a.startMinute, a.endMinute, b.startMinute, b.endMinute);
}

/// 겹침 검증 결과. 실패 시 충돌한 상대를 함께 돌려주어 UI가 해당 구간을
/// 경고색으로 표시할 수 있게 한다(FR-08, EC-05).
class OverlapResult {
  const OverlapResult.ok()
      : hasConflict = false,
        conflicts = const <OverlapConflict>[];

  const OverlapResult.conflict(this.conflicts) : hasConflict = true;

  final bool hasConflict;
  final List<OverlapConflict> conflicts;
}

/// 충돌한 구간 한 쌍.
class OverlapConflict {
  const OverlapConflict({
    required this.date,
    required this.startMinute,
    required this.endMinute,
    required this.movingInstanceId,
    required this.existingInstanceId,
  });

  final PlanDate date;

  /// 실제로 겹친 구간. 경고색 표시 범위로 사용한다.
  final int startMinute;
  final int endMinute;

  final String movingInstanceId;
  final String existingInstanceId;

  @override
  String toString() =>
      'OverlapConflict(${date.key} $startMinute~$endMinute, '
      '$movingInstanceId vs $existingInstanceId)';
}

/// [candidates]가 [existing]과 겹치는지 검증한다.
///
/// [existing]에서 [ignoreLinkIds] 또는 [ignoreInstanceIds]에 해당하는 항목은
/// 제외한다. 자기 자신을 이동하는 조작에서 이전 위치와 충돌 판정되는 것을 막기
/// 위함이다.
///
/// 자정 교차 조작 시 [candidates]에는 D일과 D+1일 인스턴스가 모두 포함되며,
/// 양쪽 날짜가 함께 검증된다(FR-08).
OverlapResult validateNoOverlap(
  List<BlockInstance> candidates,
  Iterable<BlockInstance> existing, {
  Set<String> ignoreLinkIds = const <String>{},
  Set<String> ignoreInstanceIds = const <String>{},
}) {
  final List<OverlapConflict> conflicts = <OverlapConflict>[];

  // 날짜별로 묶어 비교 대상을 좁힌다.
  final Map<String, List<BlockInstance>> existingByDate =
      <String, List<BlockInstance>>{};
  for (final BlockInstance instance in existing) {
    if (instance.linkId != null && ignoreLinkIds.contains(instance.linkId)) {
      continue;
    }
    if (ignoreInstanceIds.contains(instance.id)) continue;
    existingByDate
        .putIfAbsent(instance.date.key, () => <BlockInstance>[])
        .add(instance);
  }

  for (final BlockInstance candidate in candidates) {
    final List<BlockInstance> sameDate =
        existingByDate[candidate.date.key] ?? const <BlockInstance>[];
    for (final BlockInstance other in sameDate) {
      if (!instancesOverlap(candidate, other)) continue;
      conflicts.add(
        OverlapConflict(
          date: candidate.date,
          startMinute: candidate.startMinute > other.startMinute
              ? candidate.startMinute
              : other.startMinute,
          endMinute:
              candidate.endMinute < other.endMinute ? candidate.endMinute : other.endMinute,
          movingInstanceId: candidate.id,
          existingInstanceId: other.id,
        ),
      );
    }
  }

  // 후보끼리도 검증한다. 복사·일괄 반영 시 후보 집합 내부에 충돌이 있을 수 있다.
  for (int i = 0; i < candidates.length; i++) {
    for (int j = i + 1; j < candidates.length; j++) {
      final BlockInstance a = candidates[i];
      final BlockInstance b = candidates[j];
      if (a.linkId != null && a.linkId == b.linkId) continue;
      if (!instancesOverlap(a, b)) continue;
      conflicts.add(
        OverlapConflict(
          date: a.date,
          startMinute: a.startMinute > b.startMinute ? a.startMinute : b.startMinute,
          endMinute: a.endMinute < b.endMinute ? a.endMinute : b.endMinute,
          movingInstanceId: a.id,
          existingInstanceId: b.id,
        ),
      );
    }
  }

  return conflicts.isEmpty
      ? const OverlapResult.ok()
      : OverlapResult.conflict(conflicts);
}

/// 저장 대상 전체가 단일 점유 규칙을 만족하는지 검증한다 (BR-02, NFR-04).
///
/// 저장 직전 애플리케이션 계층 검증이며 DB 제약에 의존하지 않는다(BR-12).
bool isPlanConsistent(Iterable<BlockInstance> instances) {
  final Map<String, List<BlockInstance>> byDate =
      <String, List<BlockInstance>>{};
  for (final BlockInstance instance in instances) {
    if (!instance.isValid) return false;
    byDate.putIfAbsent(instance.date.key, () => <BlockInstance>[]).add(instance);
  }

  for (final List<BlockInstance> sameDate in byDate.values) {
    sameDate.sort(
      (BlockInstance a, BlockInstance b) =>
          a.startMinute.compareTo(b.startMinute),
    );
    for (int i = 1; i < sameDate.length; i++) {
      if (sameDate[i].startMinute < sameDate[i - 1].endMinute) return false;
    }
  }
  return true;
}

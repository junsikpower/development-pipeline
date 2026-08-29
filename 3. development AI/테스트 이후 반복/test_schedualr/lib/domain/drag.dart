/// 블럭 이동 및 길이 조절 — 자정 경계 포함 (FR-07, TD-13).
///
/// 핵심 규칙: 드래그 값은 손가락의 현재 각도가 아니라, 드래그 시작 이후의
/// 누적 회전량(부호 있는 각도/분)으로 해석한다. 동일한 손가락 최종 위치라도
/// 회전 방향에 따라 결과가 달라진다.
library;

import 'models.dart';
import 'time_grid.dart';

/// 드래그 대상.
enum DragTarget {
  /// 몸통: 길이 고정, 시작 시각만 순환 이동.
  body,

  /// 시작 핸들: 종료 시각(절대값) 고정, 시작 시각과 길이가 반대로 변화.
  startHandle,

  /// 종료 핸들: 시작 시각 고정, 길이만 변화.
  endHandle,
}

/// [block]에 [target] 조작을 [cumulativeDeltaMinutes](누적 회전량, 분 단위,
/// 시계 방향 +)만큼 적용한 새 논리 블럭을 계산한다.
///
/// 반환값은 항상 10분 그리드에 스냅되어 있고 BR-01 범위 내로 정지(clamp)된다.
/// 겹침 검증(FR-08)은 이 함수의 책임이 아니며, 호출자가 결과를 검증한 뒤
/// 충돌 시 원본 [block]으로 롤백해야 한다.
LogicalBlock applyDrag(
  LogicalBlock block,
  DragTarget target,
  double cumulativeDeltaMinutes,
) {
  switch (target) {
    case DragTarget.body:
      return _applyBodyDrag(block, cumulativeDeltaMinutes);
    case DragTarget.startHandle:
      return _applyStartHandleDrag(block, cumulativeDeltaMinutes);
    case DragTarget.endHandle:
      return _applyEndHandleDrag(block, cumulativeDeltaMinutes);
  }
}

/// 몸통 드래그: durationMinutes 고정, startMinute이 0~1439 범위를 순환한다
/// (FR-07 (3)). 10분 그리드로만 존재하므로 실질 순환 범위는 0~1430이다.
LogicalBlock _applyBodyDrag(LogicalBlock block, double deltaMinutes) {
  final double rawStart = block.startMinute + deltaMinutes;
  final int snapped = snapToGrid(rawStart);
  final int wrapped = wrapMinuteOfDay(snapped);
  // wrapMinuteOfDay는 [0, 1440)을 반환하므로 1440으로 스냅된 경계값은
  // 이미 0으로 정규화된다. maxStartMinute(1430) 초과는 발생하지 않는다.
  return block.copyWith(startMinute: wrapped);
}

/// 시작 핸들 드래그: 절대 종료 시각을 고정하고 startMinute을 변경한다.
/// durationMinutes는 그 차이만큼 반대로 변화하며 10~1440에서 정지한다
/// (FR-07 (4)).
LogicalBlock _applyStartHandleDrag(LogicalBlock block, double deltaMinutes) {
  final int absoluteEnd = block.startMinute + block.durationMinutes;

  final double rawStart = block.startMinute + deltaMinutes;
  final int lowerBound = _max(0, absoluteEnd - maxDurationMinutes);
  final int upperBound = _min(maxStartMinute, absoluteEnd - minDurationMinutes);

  final int snapped = snapToGrid(rawStart);
  final int clampedStart = clampInt(snapped, lowerBound, upperBound);
  final int newDuration = absoluteEnd - clampedStart;

  return block.copyWith(startMinute: clampedStart, durationMinutes: newDuration);
}

/// 종료 핸들 드래그: startMinute을 고정하고 durationMinutes만 변경한다.
/// 하한 10분, 상한 1440분에서 정지한다(FR-07 (5)(7)).
LogicalBlock _applyEndHandleDrag(LogicalBlock block, double deltaMinutes) {
  final double rawDuration = block.durationMinutes + deltaMinutes;
  final int snapped = snapToGrid(rawDuration);
  final int clamped = clampInt(snapped, minDurationMinutes, maxDurationMinutes);
  return block.copyWith(durationMinutes: clamped);
}

int _max(int a, int b) => a > b ? a : b;
int _min(int a, int b) => a < b ? a : b;

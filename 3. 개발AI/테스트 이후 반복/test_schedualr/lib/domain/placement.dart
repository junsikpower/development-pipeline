/// 블럭 배치 (드래그 앤 드롭) — FR-05, TD-14.
///
/// 배치는 항상 드롭 지점에서 시계 방향으로 전진하며, 반시계 방향으로
/// 확장하지 않는다. 드롭 지점 유효성 검증이 길이 산출보다 선행한다.
library;

import 'models.dart';
import 'overlap.dart';
import 'plan_date.dart';
import 'time_grid.dart';

/// 배치 결과. 성공 또는 두 가지 거부 사유(EC-06) 중 하나이다.
sealed class PlacementResult {
  const PlacementResult();
}

class PlacementSuccess extends PlacementResult {
  const PlacementSuccess(this.block);
  final LogicalBlock block;
}

/// 발생 조건 A: 드롭 지점이 기존 인스턴스가 점유한 구간 내부.
class PlacementRejectedInvalidDropPoint extends PlacementResult {
  const PlacementRejectedInvalidDropPoint();
}

/// 발생 조건 B: 드롭 지점은 유효하나 가용 길이가 10분 미만.
class PlacementRejectedInsufficientSpace extends PlacementResult {
  const PlacementRejectedInsufficientSpace(this.availableMinutes);
  final int availableMinutes;
}

/// 드롭 지점이 [sameDayExisting] 중 어느 하나의 반개구간 내부에 있는지 검사한다
/// (FR-05 (2)). 경계 시각(기존 인스턴스의 종료 시각과 일치)은 내부가 아니다.
bool isDropPointValid(int startMinute, List<BlockInstance> sameDayExisting) {
  for (final BlockInstance existing in sameDayExisting) {
    if (startMinute >= existing.startMinute && startMinute < existing.endMinute) {
      return false;
    }
  }
  return true;
}

/// [startMinute]에서 시계 방향으로 전진할 때, 다음 기존 인스턴스의 시작
/// 지점까지의 가용 길이를 계산한다. 자정을 넘어 다음 날 인스턴스가 있으면
/// 그 시작 지점까지 포함한다. 최대 1440분으로 제한한다(FR-05 (3)).
///
/// 호출 전 [isDropPointValid]로 유효성이 확인된 상태여야 한다: 유효한
/// startMinute이면 sameDayExisting 중 start > startMinute인 항목만 차단 요소가
/// 될 수 있다(start == startMinute인 항목은 startMinute을 자신의 내부에 포함하므로
/// 이미 무효로 걸러졌기 때문이다).
int computeAvailableLength(
  int startMinute,
  List<BlockInstance> sameDayExisting,
  List<BlockInstance> nextDayExisting,
) {
  int? nextBlockingStart;
  for (final BlockInstance existing in sameDayExisting) {
    if (existing.startMinute <= startMinute) continue;
    if (nextBlockingStart == null || existing.startMinute < nextBlockingStart) {
      nextBlockingStart = existing.startMinute;
    }
  }

  int raw;
  if (nextBlockingStart != null) {
    raw = nextBlockingStart - startMinute;
  } else {
    final int remainderOfDay = minutesPerDay - startMinute;
    int? nextDayBlockingStart;
    for (final BlockInstance existing in nextDayExisting) {
      if (nextDayBlockingStart == null || existing.startMinute < nextDayBlockingStart) {
        nextDayBlockingStart = existing.startMinute;
      }
    }
    raw = remainderOfDay + (nextDayBlockingStart ?? minutesPerDay);
  }

  return raw > maxDurationMinutes ? maxDurationMinutes : raw;
}

/// 템플릿을 [date]의 [dropMinuteRaw] 지점(스냅 전 원시 분 또는 각도 환산값)에
/// 배치한다. 전체 절차는 FR-05 (1)~(6)을 그대로 구현한다.
///
/// [linkId]는 새로 생성될 논리 블럭의 식별자이다(호출자가 발급).
PlacementResult placeTemplate({
  required BlockTemplate template,
  required PlanDate date,
  required double dropMinuteRaw,
  required List<BlockInstance> sameDayExisting,
  required List<BlockInstance> nextDayExisting,
  required String linkId,
}) {
  final int startMinute = wrapMinuteOfDay(snapToGrid(dropMinuteRaw));

  if (!isDropPointValid(startMinute, sameDayExisting)) {
    return const PlacementRejectedInvalidDropPoint();
  }

  final int available = computeAvailableLength(
    startMinute,
    sameDayExisting,
    nextDayExisting,
  );

  final int finalLength =
      template.defaultDurationMinutes < available
          ? template.defaultDurationMinutes
          : available;

  if (finalLength < minDurationMinutes) {
    return PlacementRejectedInsufficientSpace(available);
  }

  final LogicalBlock block = LogicalBlock(
    linkId: linkId,
    date: date,
    startMinute: startMinute,
    durationMinutes: finalLength,
    nameSnapshot: template.name,
    colorSnapshot: template.color,
    iconSnapshot: template.icon,
  );

  return PlacementSuccess(block);
}

/// 드래그 중 미리보기가 유효한 드롭 지점인지 여부만 빠르게 판정한다(FR-05 (5)).
/// 미리보기는 경고색 전환 여부만 필요하므로 길이 축소 결과까지는 계산하지 않는다.
bool isPreviewDropValid(double dropMinuteRaw, List<BlockInstance> sameDayExisting) {
  final int startMinute = wrapMinuteOfDay(snapToGrid(dropMinuteRaw));
  return isDropPointValid(startMinute, sameDayExisting);
}

/// 배치 결과가 기존 계획 전체와 겹치지 않는지 재검증한다. placeTemplate이
/// 올바르게 구현되었다면 항상 통과해야 하는 방어적 이중 검증이다(FR-08).
bool verifyPlacementNoOverlap(
  LogicalBlock placed,
  Iterable<BlockInstance> allExisting,
  String Function() idFactory,
) {
  final List<BlockInstance> candidateInstances = placed.crossesMidnight
      ? <BlockInstance>[
          BlockInstance(
            id: idFactory(),
            date: placed.date,
            startMinute: placed.startMinute,
            durationMinutes: minutesPerDay - placed.startMinute,
            nameSnapshot: placed.nameSnapshot,
            colorSnapshot: placed.colorSnapshot,
            iconSnapshot: placed.iconSnapshot,
            linkId: placed.linkId,
          ),
          BlockInstance(
            id: idFactory(),
            date: placed.date.nextDay,
            startMinute: 0,
            durationMinutes: placed.startMinute + placed.durationMinutes - minutesPerDay,
            nameSnapshot: placed.nameSnapshot,
            colorSnapshot: placed.colorSnapshot,
            iconSnapshot: placed.iconSnapshot,
            linkId: placed.linkId,
            isLinkStart: false,
          ),
        ]
      : <BlockInstance>[
          BlockInstance(
            id: idFactory(),
            date: placed.date,
            startMinute: placed.startMinute,
            durationMinutes: placed.durationMinutes,
            nameSnapshot: placed.nameSnapshot,
            colorSnapshot: placed.colorSnapshot,
            iconSnapshot: placed.iconSnapshot,
          ),
        ];

  return !validateNoOverlap(candidateInstances, allExisting).hasConflict;
}

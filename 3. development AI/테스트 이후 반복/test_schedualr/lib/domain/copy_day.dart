/// 다른 날짜 계획 복사 — FR-13, TD-17.
///
/// 복사 대상은 대표 인스턴스의 date가 원본 날짜와 일치하는 논리 블럭으로
/// 한정한다. 전날에서 이어져 온 구간(대표가 아닌 이월분)은 복사하지 않는다
/// (근거: 대상 날짜의 전날을 소급 변경하는 예측 불가능한 부수효과 방지).
library;

import 'models.dart';
import 'overlap.dart';
import 'plan_date.dart';
import 'time_grid.dart';

/// 복사 결과. [createdBlocks]는 대상 날짜에 반영될 논리 블럭,
/// [excludedBlockNames]는 T+1일 충돌로 제외된 블럭의 명칭 목록이다(EC-09).
class CopyDayResult {
  const CopyDayResult({
    required this.createdBlocks,
    required this.excludedBlockNames,
  });

  final List<LogicalBlock> createdBlocks;
  final List<String> excludedBlockNames;

  bool get hasExclusions => excludedBlockNames.isNotEmpty;
}

/// [sourceBlocks]([sourceDate]가 대표 날짜인 논리 블럭만 — 호출자가 이미
/// `block.date == sourceDate`로 필터링해 전달해야 한다)를 [targetDate]로
/// 복사한다.
///
/// [targetNextDayExisting]은 대상 날짜 다음 날(T+1)의 **기존** 인스턴스이며
/// 이 함수는 그 데이터를 변경하지 않는다 — 충돌 판정에만 사용한다. 대상
/// 날짜(T)의 기존 인스턴스는 호출자가 이미 전량 삭제했다고 가정한다(EC-08,
/// BR-12의 단일 트랜잭션 범위는 저장 계층의 책임이다).
///
/// [idFactory]는 새 논리 블럭마다 새 linkId를 발급한다.
CopyDayResult copyDayPlan({
  required PlanDate sourceDate,
  required PlanDate targetDate,
  required List<LogicalBlock> sourceBlocks,
  required List<BlockInstance> targetNextDayExisting,
  required String Function() idFactory,
}) {
  assert(
    sourceBlocks.every((LogicalBlock b) => b.date == sourceDate),
    '복사 대상이 아닌 논리 블럭(이월분 등)이 섞여 있습니다.',
  );

  final List<LogicalBlock> created = <LogicalBlock>[];
  final List<String> excluded = <String>[];

  for (final LogicalBlock source in sourceBlocks) {
    final LogicalBlock candidate = LogicalBlock(
      linkId: idFactory(),
      date: targetDate,
      startMinute: source.startMinute,
      durationMinutes: source.durationMinutes,
      nameSnapshot: source.nameSnapshot,
      colorSnapshot: source.colorSnapshot,
      iconSnapshot: source.iconSnapshot,
      preNotifyMinutes: source.preNotifyMinutes,
      // 완료 상태는 복제하지 않는다(FR-13 (2)).
      isCompleted: false,
    );

    if (!candidate.crossesMidnight) {
      created.add(candidate);
      continue;
    }

    final int tailStart = 0;
    final int tailEnd = candidate.startMinute + candidate.durationMinutes - minutesPerDay;

    final bool conflictsWithNextDay = targetNextDayExisting.any(
      (BlockInstance existing) => intervalsOverlap(
        tailStart,
        tailEnd,
        existing.startMinute,
        existing.endMinute,
      ),
    );

    if (conflictsWithNextDay) {
      excluded.add(source.nameSnapshot);
    } else {
      created.add(candidate);
    }
  }

  return CopyDayResult(createdBlocks: created, excludedBlockNames: excluded);
}

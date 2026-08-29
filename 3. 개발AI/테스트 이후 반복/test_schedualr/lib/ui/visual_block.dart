/// 편집 화면에서 다루는 논리 블럭의 화면 표시 단위.
///
/// [LogicalBlock]은 자정을 넘어도 하나의 값(시작+총 길이)으로 표현되지만,
/// 링에는 오늘 날짜 구간만 그려야 한다(FR-03 (2)). 이 클래스가 그 변환을 맡는다.
library;

import '../domain/domain.dart';

class VisualBlock {
  const VisualBlock({
    required this.logical,
    required this.segmentStart,
    required this.segmentEnd,
    required this.continuationAtStart,
    required this.continuationAtEnd,
    this.isConflict = false,
  });

  /// 원본 논리 블럭. 조작은 항상 이 전체 단위로 수행된다(BR-04).
  final LogicalBlock logical;

  /// 오늘 날짜 링 위에 실제로 그려질 구간 [segmentStart, segmentEnd).
  final int segmentStart;
  final int segmentEnd;

  /// 시작 끝단에 연속 표식을 표시할지(전날에서 이어짐) — FR-03 (2).
  final bool continuationAtStart;

  /// 종료 끝단에 연속 표식을 표시할지(다음 날로 이어짐).
  final bool continuationAtEnd;

  final bool isConflict;

  /// 편집·삭제·완료·알림 조작의 단위 식별자. 링크 없는 블럭은 자기 id.
  String get key => logical.linkId;

  VisualBlock copyWith({LogicalBlock? logical, bool? isConflict}) {
    return VisualBlock(
      logical: logical ?? this.logical,
      segmentStart: segmentStart,
      segmentEnd: segmentEnd,
      continuationAtStart: continuationAtStart,
      continuationAtEnd: continuationAtEnd,
      isConflict: isConflict ?? this.isConflict,
    );
  }
}

/// [date]에 표시되는 논리 블럭들을 화면용 세그먼트로 변환한다.
List<VisualBlock> buildVisualBlocks(PlanDate date, List<LogicalBlock> touching) {
  final List<VisualBlock> result = <VisualBlock>[];
  for (final LogicalBlock block in touching) {
    if (block.date == date) {
      final bool crosses = block.crossesMidnight;
      result.add(
        VisualBlock(
          logical: block,
          segmentStart: block.startMinute,
          segmentEnd: crosses ? 1440 : block.startMinute + block.durationMinutes,
          continuationAtStart: false,
          continuationAtEnd: crosses,
        ),
      );
    } else if (block.date == date.previousDay && block.crossesMidnight) {
      final int tailLength = block.startMinute + block.durationMinutes - 1440;
      result.add(
        VisualBlock(
          logical: block,
          segmentStart: 0,
          segmentEnd: tailLength,
          continuationAtStart: true,
          continuationAtEnd: false,
        ),
      );
    }
  }
  return result;
}

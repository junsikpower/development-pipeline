/// 터치 판정 규칙 — FR-03 (4), BR-10.
///
/// 좌표계는 UI 계층이 자유롭게 정할 수 있으나(12.3 (1)), 단위는 호출자
/// 전체에서 일관되어야 한다(예: 분 단위 또는 반지름으로 환산한 픽셀 단위).
/// 이 모듈은 순수하게 "겹치는 확장 터치 영역 중 어느 것을 선택할지"만 판정한다.
library;

/// 하나의 터치 판정 대상. [isHandle]이 true이면 몸통보다 우선 판정된다.
class TouchRegion {
  const TouchRegion({
    required this.id,
    required this.originalStart,
    required this.originalEnd,
    required this.isHandle,
  });

  final String id;

  /// 확장 전 원본 호 구간 [originalStart, originalEnd).
  final double originalStart;
  final double originalEnd;

  final bool isHandle;

  double get originalLength => originalEnd - originalStart;
}

/// 확장된 터치 영역. [expandedStart], [expandedEnd]는 BR-10의 규칙에 따라
/// 원본 길이가 [minTouchLength] 미만일 때만 양방향으로 균등 확장된 값이다.
class ExpandedTouchRegion {
  const ExpandedTouchRegion({
    required this.source,
    required this.expandedStart,
    required this.expandedEnd,
  });

  final TouchRegion source;
  final double expandedStart;
  final double expandedEnd;

  bool contains(double point) => point >= expandedStart && point < expandedEnd;
}

/// [region]의 터치 영역을 계산한다. 호 중심선 길이가 [minTouchLength] 미만이면
/// 부족분을 양방향에 각각 절반씩 배분하여 확장한다. minTouchLength를 양쪽에
/// 각각 더하지 않는다(BR-10).
ExpandedTouchRegion expandTouchRegion(TouchRegion region, double minTouchLength) {
  final double length = region.originalLength;
  if (length >= minTouchLength) {
    return ExpandedTouchRegion(
      source: region,
      expandedStart: region.originalStart,
      expandedEnd: region.originalEnd,
    );
  }
  final double deficit = (minTouchLength - length) / 2;
  return ExpandedTouchRegion(
    source: region,
    expandedStart: region.originalStart - deficit,
    expandedEnd: region.originalEnd + deficit,
  );
}

/// [touchPoint]로부터 [region] 원본 구간까지의 최단 거리. 내부에 있으면 0이다.
/// 인접 블럭 경계 판정의 "더 가까운 쪽"을 결정하는 기준이다.
double distanceToOriginal(double touchPoint, TouchRegion region) {
  if (touchPoint >= region.originalStart && touchPoint < region.originalEnd) {
    return 0;
  }
  final double toStart = (touchPoint - region.originalStart).abs();
  final double toEnd = (touchPoint - region.originalEnd).abs();
  return toStart < toEnd ? toStart : toEnd;
}

/// [touchPoint]에서 선택될 인스턴스 id를 판정한다.
///
/// 1. 확장 터치 영역에 포함되는 후보를 모은다.
/// 2. 핸들 후보가 하나라도 있으면 핸들만 남긴다(BR-10: 핸들이 몸통보다 우선).
/// 3. 후보가 여럿이면 원본 구간까지의 거리가 더 가까운 쪽을 선택한다.
/// 4. 후보가 없으면 null을 반환한다 — 빈 영역 터치, 선택 해제(FR-03 (4)).
String? pickRegionAt(
  double touchPoint,
  List<TouchRegion> regions,
  double minTouchLength,
) {
  final List<ExpandedTouchRegion> expanded = regions
      .map((TouchRegion r) => expandTouchRegion(r, minTouchLength))
      .toList(growable: false);

  List<ExpandedTouchRegion> matches =
      expanded.where((ExpandedTouchRegion e) => e.contains(touchPoint)).toList();

  if (matches.isEmpty) return null;

  final List<ExpandedTouchRegion> handleMatches =
      matches.where((ExpandedTouchRegion e) => e.source.isHandle).toList();
  if (handleMatches.isNotEmpty) {
    matches = handleMatches;
  }

  matches.sort(
    (ExpandedTouchRegion a, ExpandedTouchRegion b) => distanceToOriginal(
      touchPoint,
      a.source,
    ).compareTo(distanceToOriginal(touchPoint, b.source)),
  );

  return matches.first.source.id;
}

/// 자정 교차 논리 블럭의 분할 저장 및 링크 관리 (FR-09, BR-04, TD-06).
///
/// 이 모듈은 두 표현 사이의 양방향 변환을 담당한다.
///   - 논리 블럭 -> 인스턴스 1~2개  : [splitLogicalBlock]
///   - 인스턴스 목록 -> 논리 블럭들 : [rebuildLogicalBlocks]
///
/// 모든 조작은 논리 블럭 단위로 수행한 뒤 재분할한다. 두 인스턴스의 값을
/// 개별적으로 조정하지 않는다(FR-07 (8)).
library;

import 'models.dart';
import 'time_grid.dart';

/// 인스턴스 식별자 생성기. 테스트에서 결정적 id를 주입할 수 있게 분리한다.
typedef IdFactory = String Function();

/// 논리 블럭을 FR-09 (1)의 분할 규칙에 따라 인스턴스로 환원한다.
///
/// 자정을 넘지 않으면 인스턴스 1개를 반환하며 `linkId`는 null이다.
/// 자정을 넘으면 대표(A) + 비대표(B) 2개를 반환하며 동일한 `linkId`를 공유한다.
///
/// [reuseIds]가 주어지면 앞에서부터 순서대로 재사용한다. 부족한 만큼만
/// [idFactory]로 생성한다. 이로써 갱신 저장 시 기존 레코드의 id가 보존된다.
List<BlockInstance> splitLogicalBlock(
  LogicalBlock block, {
  required IdFactory idFactory,
  List<String> reuseIds = const <String>[],
}) {
  assert(block.isValid, '분할 대상 논리 블럭이 불변식을 위반했습니다: $block');

  int cursor = 0;
  String takeId() =>
      cursor < reuseIds.length ? reuseIds[cursor++] : idFactory();

  final int s = block.startMinute;
  final int dur = block.durationMinutes;

  // 자정을 넘지 않는 경우: 단일 인스턴스. 링크는 존재하지 않는다.
  if (s + dur <= minutesPerDay) {
    return <BlockInstance>[
      BlockInstance(
        id: takeId(),
        date: block.date,
        startMinute: s,
        durationMinutes: dur,
        nameSnapshot: block.nameSnapshot,
        colorSnapshot: block.colorSnapshot,
        iconSnapshot: block.iconSnapshot,
        isLinkStart: true,
        preNotifyMinutes: block.preNotifyMinutes,
        isCompleted: block.isCompleted,
      ),
    ];
  }

  // 자정 교차: A는 당일의 남은 구간, B는 다음 날의 이월 구간.
  final int headDuration = minutesPerDay - s;
  final int tailDuration = s + dur - minutesPerDay;

  // FR-09 (4): 이월 구간이 0이면 링크가 성립하지 않는다. 위 분기에서 걸러지므로
  // 여기 도달했다면 tailDuration은 항상 양수여야 한다.
  assert(tailDuration > 0, '이월 구간이 0인 상태로 분할에 진입했습니다: $block');

  return <BlockInstance>[
    BlockInstance(
      id: takeId(),
      date: block.date,
      startMinute: s,
      durationMinutes: headDuration,
      nameSnapshot: block.nameSnapshot,
      colorSnapshot: block.colorSnapshot,
      iconSnapshot: block.iconSnapshot,
      linkId: block.linkId,
      isLinkStart: true,
      preNotifyMinutes: block.preNotifyMinutes,
      isCompleted: block.isCompleted,
    ),
    BlockInstance(
      id: takeId(),
      date: block.date.nextDay,
      startMinute: 0,
      durationMinutes: tailDuration,
      nameSnapshot: block.nameSnapshot,
      colorSnapshot: block.colorSnapshot,
      iconSnapshot: block.iconSnapshot,
      linkId: block.linkId,
      isLinkStart: false,
      // 비대표 인스턴스는 논리 블럭 단위 속성을 보유하지 않는다(BR-04).
      isCompleted: false,
    ),
  ];
}

/// 인스턴스 목록으로부터 논리 블럭을 복원한다.
///
/// 링크 그룹은 `linkId`로 묶고 대표(`isLinkStart == true`)에서 논리 블럭 단위
/// 속성을 취한다. 총 길이는 그룹 내 모든 인스턴스의 길이 합이다(FR-09 (2)).
///
/// [instances]에는 여러 날짜의 인스턴스가 섞여 있어도 된다. 대표가 없는
/// 그룹(다음 날 구간만 조회된 경우)은 [orphanTailBuilder]로 처리한다.
List<LogicalBlock> rebuildLogicalBlocks(
  Iterable<BlockInstance> instances, {
  LogicalBlock Function(BlockInstance tail)? orphanTailBuilder,
}) {
  final Map<String, List<BlockInstance>> groups =
      <String, List<BlockInstance>>{};
  final List<LogicalBlock> result = <LogicalBlock>[];

  for (final BlockInstance instance in instances) {
    final String? linkId = instance.linkId;
    if (linkId == null) {
      // 링크되지 않은 인스턴스는 그 자체가 완결된 논리 블럭이다.
      result.add(_logicalFromSingle(instance));
    } else {
      groups.putIfAbsent(linkId, () => <BlockInstance>[]).add(instance);
    }
  }

  for (final MapEntry<String, List<BlockInstance>> entry in groups.entries) {
    final List<BlockInstance> group = entry.value;
    final BlockInstance? head = _findRepresentative(group);

    if (head == null) {
      // 대표가 조회 범위 밖에 있는 경우. 이월 구간만으로는 논리 블럭의 시작
      // 시각을 알 수 없으므로 호출자가 보충하도록 위임한다.
      for (final BlockInstance tail in group) {
        final LogicalBlock? built = orphanTailBuilder?.call(tail);
        if (built != null) result.add(built);
      }
      continue;
    }

    final int totalDuration = group.fold<int>(
      0,
      (int sum, BlockInstance i) => sum + i.durationMinutes,
    );

    result.add(
      LogicalBlock(
        linkId: entry.key,
        date: head.date,
        startMinute: head.startMinute,
        durationMinutes: totalDuration,
        nameSnapshot: head.nameSnapshot,
        colorSnapshot: head.colorSnapshot,
        iconSnapshot: head.iconSnapshot,
        preNotifyMinutes: head.preNotifyMinutes,
        isCompleted: head.isCompleted,
        instanceIds: _orderedIds(group),
        isPersisted: true,
      ),
    );
  }

  result.sort((LogicalBlock a, LogicalBlock b) {
    final int byDate = a.date.compareTo(b.date);
    return byDate != 0 ? byDate : a.startMinute.compareTo(b.startMinute);
  });
  return result;
}

LogicalBlock _logicalFromSingle(BlockInstance instance) {
  return LogicalBlock(
    // 링크가 없는 인스턴스는 자기 id를 논리 식별자로 사용한다.
    linkId: instance.id,
    date: instance.date,
    startMinute: instance.startMinute,
    durationMinutes: instance.durationMinutes,
    nameSnapshot: instance.nameSnapshot,
    colorSnapshot: instance.colorSnapshot,
    iconSnapshot: instance.iconSnapshot,
    preNotifyMinutes: instance.preNotifyMinutes,
    isCompleted: instance.isCompleted,
    instanceIds: <String>[instance.id],
    isPersisted: true,
  );
}

/// 링크 그룹의 대표를 찾는다. 그룹당 정확히 1개여야 한다(NFR-04).
BlockInstance? _findRepresentative(List<BlockInstance> group) {
  BlockInstance? found;
  for (final BlockInstance instance in group) {
    if (!instance.isLinkStart) continue;
    assert(found == null, '링크 그룹에 대표 인스턴스가 2개 이상입니다: ${instance.linkId}');
    found = instance;
  }
  return found;
}

/// 대표를 앞에 두고 날짜순으로 정렬한 id 목록.
List<String> _orderedIds(List<BlockInstance> group) {
  final List<BlockInstance> sorted = List<BlockInstance>.of(group)
    ..sort((BlockInstance a, BlockInstance b) {
      if (a.isLinkStart != b.isLinkStart) return a.isLinkStart ? -1 : 1;
      return a.date.compareTo(b.date);
    });
  return sorted.map((BlockInstance i) => i.id).toList(growable: false);
}

/// 링크 그룹 정합성 검증 (NFR-04).
///
/// 저장 직전에 호출하여 대표가 정확히 1개인지, 길이 합이 논리 블럭 총 길이와
/// 일치하는지 확인한다.
bool isLinkGroupConsistent(List<BlockInstance> group, int expectedTotal) {
  if (group.isEmpty) return false;
  final int representatives =
      group.where((BlockInstance i) => i.isLinkStart).length;
  if (representatives != 1) return false;

  final int total = group.fold<int>(
    0,
    (int sum, BlockInstance i) => sum + i.durationMinutes,
  );
  if (total != expectedTotal) return false;

  return group.every((BlockInstance i) => i.isValid);
}

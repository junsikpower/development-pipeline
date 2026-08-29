import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

LogicalBlock block({
  required PlanDate date,
  required int start,
  required int duration,
  String linkId = 'L1',
  int? preNotify,
  bool completed = false,
}) {
  return LogicalBlock(
    linkId: linkId,
    date: date,
    startMinute: start,
    durationMinutes: duration,
    nameSnapshot: '수면',
    colorSnapshot: 0xFF000000,
    iconSnapshot: 'sleep',
    preNotifyMinutes: preNotify,
    isCompleted: completed,
  );
}

void main() {
  final PlanDate d = PlanDate(2026, 8, 19);

  group('FR-09 자정 교차 분할', () {
    test('23:00 시작 480분 블럭이 D일 60분(대표) + D+1일 420분으로 저장된다', () {
      final LogicalBlock b = block(date: d, start: 1380, duration: 480);
      final List<BlockInstance> instances = splitLogicalBlock(
        b,
        idFactory: () => 'x',
        reuseIds: <String>['A', 'B'],
      );

      expect(instances.length, 2);
      final BlockInstance head = instances[0];
      final BlockInstance tail = instances[1];

      expect(head.date, d);
      expect(head.startMinute, 1380);
      expect(head.durationMinutes, 60);
      expect(head.isLinkStart, isTrue);
      expect(head.linkId, 'L1');

      expect(tail.date, d.nextDay);
      expect(tail.startMinute, 0);
      expect(tail.durationMinutes, 420);
      expect(tail.isLinkStart, isFalse);
      expect(tail.linkId, 'L1');

      expect(head.durationMinutes + tail.durationMinutes, 480);
    });

    test('자정을 넘지 않으면 단일 인스턴스이며 linkId가 없다', () {
      final LogicalBlock b = block(date: d, start: 480, duration: 60);
      final List<BlockInstance> instances = splitLogicalBlock(
        b,
        idFactory: () => 'x',
      );
      expect(instances.length, 1);
      expect(instances.first.linkId, isNull);
      expect(instances.first.isLinkStart, isTrue);
    });

    test('링크 그룹의 알림이 23:00 기준 1회만 예약된다 (대표만 preNotify 보유)', () {
      final LogicalBlock b = block(date: d, start: 1380, duration: 480, preNotify: 10);
      final List<BlockInstance> instances = splitLogicalBlock(b, idFactory: () => 'x');
      expect(instances[0].preNotifyMinutes, 10);
      expect(instances[1].preNotifyMinutes, isNull);
    });

    test('rebuildLogicalBlocks는 링크 그룹을 하나의 논리 블럭으로 복원한다', () {
      final LogicalBlock original = block(date: d, start: 1380, duration: 480);
      final List<BlockInstance> instances = splitLogicalBlock(
        original,
        idFactory: () => 'x',
        reuseIds: <String>['A', 'B'],
      );

      final List<LogicalBlock> rebuilt = rebuildLogicalBlocks(instances);
      expect(rebuilt.length, 1);
      expect(rebuilt.first.startMinute, 1380);
      expect(rebuilt.first.durationMinutes, 480);
      expect(rebuilt.first.date, d);
      expect(rebuilt.first.instanceIds, <String>['A', 'B']);
    });

    test('길이를 60분으로 줄이면 D+1일 인스턴스가 제거되고 단일 인스턴스가 된다', () {
      final LogicalBlock shortened = block(date: d, start: 1380, duration: 60);
      final List<BlockInstance> instances = splitLogicalBlock(shortened, idFactory: () => 'x');
      expect(instances.length, 1);
      expect(instances.first.linkId, isNull);
    });

    test('링크 그룹 정합성 검증: 대표가 정확히 1개이고 길이 합이 총 길이와 일치', () {
      final LogicalBlock b = block(date: d, start: 1380, duration: 480);
      final List<BlockInstance> instances = splitLogicalBlock(b, idFactory: () => 'x');
      expect(isLinkGroupConsistent(instances, 480), isTrue);
      expect(isLinkGroupConsistent(instances, 470), isFalse);
    });

    test('24시간 블럭(start=0)은 단일 인스턴스로 저장된다 (FR-07 (7))', () {
      final LogicalBlock full = block(date: d, start: 0, duration: 1440);
      final List<BlockInstance> instances = splitLogicalBlock(full, idFactory: () => 'x');
      expect(instances.length, 1);
      expect(instances.first.durationMinutes, 1440);
    });
  });
}

import 'package:circular_scheduler/domain/domain.dart';
import 'package:circular_scheduler/ui/visual_block.dart';
import 'package:flutter_test/flutter_test.dart';

LogicalBlock lb(PlanDate date, int start, int dur) {
  return LogicalBlock(
    linkId: 'L_${date.key}_$start',
    date: date,
    startMinute: start,
    durationMinutes: dur,
    nameSnapshot: 'n',
    colorSnapshot: 0,
    iconSnapshot: 'i',
    instanceIds: const <String>['i1'],
    isPersisted: true,
  );
}

void main() {
  final PlanDate d = PlanDate(2026, 8, 19);

  group('FR-03 (2) 자정 경계 렌더링', () {
    test('자정을 넘지 않는 블럭은 연속 표식이 없다', () {
      final visuals = buildVisualBlocks(d, [lb(d, 480, 60)]);
      expect(visuals.length, 1);
      expect(visuals.first.continuationAtStart, isFalse);
      expect(visuals.first.continuationAtEnd, isFalse);
      expect(visuals.first.segmentStart, 480);
      expect(visuals.first.segmentEnd, 540);
    });

    test('오늘 시작해 자정을 넘는 블럭은 종료 끝단에 연속 표식을 갖고 세그먼트가 24:00에서 끊긴다', () {
      final visuals = buildVisualBlocks(d, [lb(d, 1380, 480)]); // 23:00 + 480분
      expect(visuals.length, 1);
      expect(visuals.first.segmentStart, 1380);
      expect(visuals.first.segmentEnd, 1440); // 자기 날짜 링 범위 안에서만 그려진다
      expect(visuals.first.continuationAtEnd, isTrue);
      expect(visuals.first.continuationAtStart, isFalse);
    });

    test('전날에서 이어진 블럭은 시작 끝단에 연속 표식을 갖고 00:00부터 그려진다', () {
      final yesterdayBlock = lb(d.previousDay, 1380, 480); // D-1일 23:00 시작, D일 07:00까지
      final visuals = buildVisualBlocks(d, [yesterdayBlock]);
      expect(visuals.length, 1);
      expect(visuals.first.segmentStart, 0);
      expect(visuals.first.segmentEnd, 420); // 07:00
      expect(visuals.first.continuationAtStart, isTrue);
      expect(visuals.first.continuationAtEnd, isFalse);
    });

    test('오늘과 무관한 다른 날짜 블럭은 표시되지 않는다', () {
      final farBlock = lb(d.addDays(5), 0, 60);
      final visuals = buildVisualBlocks(d, [farBlock]);
      expect(visuals, isEmpty);
    });
  });
}

import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

LogicalBlock lb(PlanDate date, int start, int dur, {String name = 'n', int? pre, bool completed = false}) {
  return LogicalBlock(
    linkId: 'orig_${date.key}_$start',
    date: date,
    startMinute: start,
    durationMinutes: dur,
    nameSnapshot: name,
    colorSnapshot: 0,
    iconSnapshot: 'i',
    preNotifyMinutes: pre,
    isCompleted: completed,
    instanceIds: <String>['orig'],
    isPersisted: true,
  );
}

BlockInstance inst(PlanDate date, int start, int dur, {String id = 'x'}) {
  return BlockInstance(
    id: id,
    date: date,
    startMinute: start,
    durationMinutes: dur,
    nameSnapshot: 'existing',
    colorSnapshot: 0,
    iconSnapshot: 'i',
  );
}

void main() {
  final PlanDate s = PlanDate(2026, 8, 10);
  final PlanDate t = PlanDate(2026, 8, 19);

  group('FR-13 다른 날짜 계획 복사', () {
    test('복사 실행 후 대상 날짜의 블럭 구성이 원본과 일치한다', () {
      final source = <LogicalBlock>[lb(s, 480, 60, name: '공부'), lb(s, 600, 30, name: '운동')];
      final result = copyDayPlan(
        sourceDate: s,
        targetDate: t,
        sourceBlocks: source,
        targetNextDayExisting: const <BlockInstance>[],
        idFactory: () => 'new-id',
      );
      expect(result.createdBlocks.length, 2);
      expect(result.createdBlocks[0].startMinute, 480);
      expect(result.createdBlocks[0].durationMinutes, 60);
      expect(result.createdBlocks[0].date, t);
    });

    test('복제된 블럭의 완료 상태가 모두 미완료이다', () {
      final source = <LogicalBlock>[lb(s, 480, 60, completed: true)];
      final result = copyDayPlan(
        sourceDate: s,
        targetDate: t,
        sourceBlocks: source,
        targetNextDayExisting: const <BlockInstance>[],
        idFactory: () => 'new-id',
      );
      expect(result.createdBlocks.first.isCompleted, isFalse);
    });

    test('T+1일과 충돌하는 자정 교차 블럭이 있으면 해당 블럭만 제외되고 고지된다', () {
      final source = <LogicalBlock>[
        lb(s, 1380, 480, name: '수면'), // T일 23:00 ~ T+1일 07:00
        lb(s, 480, 60, name: '공부'), // 자정 미교차, 영향 없음
      ];
      final conflictingNextDay = inst(t.nextDay, 120, 60, id: 'conflict'); // T+1 02:00~03:00
      final result = copyDayPlan(
        sourceDate: s,
        targetDate: t,
        sourceBlocks: source,
        targetNextDayExisting: <BlockInstance>[conflictingNextDay],
        idFactory: () => 'new-id',
      );
      expect(result.createdBlocks.length, 1);
      expect(result.createdBlocks.first.nameSnapshot, '공부');
      expect(result.excludedBlockNames, <String>['수면']);
      expect(result.hasExclusions, isTrue);
    });

    test('T+1일과 충돌하지 않으면 자정 교차 블럭도 정상 복사된다', () {
      final source = <LogicalBlock>[lb(s, 1380, 480, name: '수면')];
      final result = copyDayPlan(
        sourceDate: s,
        targetDate: t,
        sourceBlocks: source,
        targetNextDayExisting: const <BlockInstance>[],
        idFactory: () => 'new-id',
      );
      expect(result.createdBlocks.length, 1);
      expect(result.hasExclusions, isFalse);
    });
  });
}

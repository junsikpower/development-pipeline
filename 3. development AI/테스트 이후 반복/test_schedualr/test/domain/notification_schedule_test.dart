import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

LogicalBlock blockAt(PlanDate date, int start, {int? pre, List<String>? ids}) {
  return LogicalBlock(
    linkId: 'L_$start',
    date: date,
    startMinute: start,
    durationMinutes: 30,
    nameSnapshot: 'B$start',
    colorSnapshot: 0,
    iconSnapshot: 'i',
    preNotifyMinutes: pre,
    instanceIds: ids ?? <String>['inst_$start'],
    isPersisted: true,
  );
}

void main() {
  final PlanDate d = PlanDate(2026, 8, 19);
  final DateTime now = d.atMinute(0);

  group('FR-11 예약 후보 수집', () {
    test('과거 시각의 후보는 예약하지 않는다', () {
      final past = blockAt(d, 0); // 자정 정각, now와 동일 -> 미래 아님
      final future = blockAt(d, 600);
      final candidates = collectCandidates(<LogicalBlock>[past, future], now);
      expect(candidates.length, 1);
      expect(candidates.first.fireAt, future.startMoment.toDateTime());
    });

    test('사전 알림이 설정된 블럭은 예약 후보 2개를 갖는다', () {
      final b = blockAt(d, 600, pre: 10);
      final candidates = collectCandidates(<LogicalBlock>[b], now);
      expect(candidates.length, 2);
      expect(candidates.map((c) => c.type), containsAll(<NotificationType>[
        NotificationType.start,
        NotificationType.pre,
      ]));
    });
  });

  group('FR-11 예약 큐 산출 (BR-06)', () {
    test('알림 후보가 60개일 때 49개의 계획 알림과 1개의 예약 갱신 리마인더가 예약된다', () {
      final blocks = List<LogicalBlock>.generate(
        60,
        (i) => blockAt(d, 10 + i, ids: <String>['inst_$i']),
      );
      final candidates = collectCandidates(blocks, now);
      expect(candidates.length, 60);
      final queue = buildScheduleQueue(candidates);
      final planCount = queue.scheduled
          .where((item) => item.type != NotificationType.horizonReminder)
          .length;
      final reminderCount = queue.scheduled
          .where((item) => item.type == NotificationType.horizonReminder)
          .length;
      expect(planCount, 49);
      expect(reminderCount, 1);
      expect(queue.scheduled.length, 50);
      expect(queue.unscheduledCount, 11);
    });

    test('알림 후보가 20개일 때 예약 갱신 리마인더가 예약되지 않는다', () {
      final blocks = List<LogicalBlock>.generate(
        20,
        (i) => blockAt(d, 10 + i, ids: <String>['inst_$i']),
      );
      final candidates = collectCandidates(blocks, now);
      final queue = buildScheduleQueue(candidates);
      expect(queue.scheduled.length, 20);
      expect(
        queue.scheduled.any((item) => item.type == NotificationType.horizonReminder),
        isFalse,
      );
      expect(queue.unscheduledCount, 0);
    });

    test('예약 항목 수가 50개를 초과하지 않는다', () {
      final blocks = List<LogicalBlock>.generate(
        100,
        (i) => blockAt(d, 10 + i, ids: <String>['inst_$i']),
      );
      final candidates = collectCandidates(blocks, now);
      final queue = buildScheduleQueue(candidates);
      expect(queue.scheduled.length, lessThanOrEqualTo(50));
    });
  });

  group('FR-12 알림 문구', () {
    test('사전 알림과 시작 알림의 본문이 서로 다르다', () {
      final b = blockAt(d, 600, pre: 10);
      final candidates = collectCandidates(<LogicalBlock>[b], now);
      final queue = buildScheduleQueue(candidates);
      final bodies = queue.scheduled.map((i) => i.body).toSet();
      expect(bodies.length, 2);
    });

    test('알림 제목에 블럭 명칭이 표시된다', () {
      final b = blockAt(d, 600);
      final candidates = collectCandidates(<LogicalBlock>[b], now);
      final queue = buildScheduleQueue(candidates);
      expect(queue.scheduled.first.title, 'B600');
    });
  });

  test('notificationIdFor는 동일 key에 대해 결정적이다', () {
    expect(notificationIdFor('a_start'), notificationIdFor('a_start'));
    expect(notificationIdFor('a_start'), isNot(equals(notificationIdFor('a_pre'))));
  });
}

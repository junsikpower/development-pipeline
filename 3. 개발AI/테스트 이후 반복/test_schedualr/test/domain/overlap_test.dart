import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

BlockInstance inst(PlanDate date, int start, int dur, {String id = 'i', String? linkId, bool linkStart = true}) {
  return BlockInstance(
    id: id,
    date: date,
    startMinute: start,
    durationMinutes: dur,
    nameSnapshot: 'n',
    colorSnapshot: 0,
    iconSnapshot: 'i',
    linkId: linkId,
    isLinkStart: linkStart,
  );
}

void main() {
  final PlanDate d = PlanDate(2026, 8, 19);

  group('BR-02 겹침 판정', () {
    test('경계 시각 공유는 겹침이 아니다', () {
      expect(intervalsOverlap(600, 660, 660, 720), isFalse);
    });

    test('구간이 교차하면 겹침이다', () {
      expect(intervalsOverlap(600, 660, 630, 690), isTrue);
    });

    test('날짜가 다르면 절대 겹치지 않는다', () {
      final BlockInstance a = inst(d, 600, 60, id: 'a');
      final BlockInstance b = inst(d.nextDay, 600, 60, id: 'b');
      expect(instancesOverlap(a, b), isFalse);
    });
  });

  group('FR-08 겹침 검증', () {
    test('10:00~11:00 점유 상태에서 10:30 시작 후보는 충돌로 판정된다', () {
      final existing = inst(d, 600, 60, id: 'existing');
      final candidate = inst(d, 630, 30, id: 'candidate');
      final result = validateNoOverlap(<BlockInstance>[candidate], <BlockInstance>[existing]);
      expect(result.hasConflict, isTrue);
    });

    test('11:00 정각 시작 후보는 충돌이 아니다 (경계 공유)', () {
      final existing = inst(d, 600, 60, id: 'existing');
      final candidate = inst(d, 660, 30, id: 'candidate');
      final result = validateNoOverlap(<BlockInstance>[candidate], <BlockInstance>[existing]);
      expect(result.hasConflict, isFalse);
    });

    test('자정 교차 블럭을 다음 날 기존 블럭과 겹치도록 늘리면 겹침으로 판정된다', () {
      final nextDayExisting = inst(d.nextDay, 420, 60, id: 'nextday'); // 07:00~08:00
      final tail = inst(d.nextDay, 0, 480, id: 'tail', linkId: 'L', linkStart: false); // 00:00~08:00
      final result = validateNoOverlap(<BlockInstance>[tail], <BlockInstance>[nextDayExisting]);
      expect(result.hasConflict, isTrue);
    });
  });

  group('NFR-04 전체 정합성', () {
    test('겹치는 쌍이 없는 계획은 정합하다', () {
      final a = inst(d, 0, 480, id: 'a');
      final b = inst(d, 480, 60, id: 'b');
      expect(isPlanConsistent(<BlockInstance>[a, b]), isTrue);
    });

    test('겹치는 쌍이 있으면 정합하지 않다', () {
      final a = inst(d, 0, 480, id: 'a');
      final b = inst(d, 470, 60, id: 'b');
      expect(isPlanConsistent(<BlockInstance>[a, b]), isFalse);
    });

    test('10분 배수가 아닌 인스턴스는 정합하지 않다', () {
      final a = inst(d, 5, 60, id: 'a');
      expect(isPlanConsistent(<BlockInstance>[a]), isFalse);
    });
  });
}

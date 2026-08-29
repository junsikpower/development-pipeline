import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

BlockInstance inst(PlanDate date, int start, int dur, {String id = 'i'}) {
  return BlockInstance(
    id: id,
    date: date,
    startMinute: start,
    durationMinutes: dur,
    nameSnapshot: 'n',
    colorSnapshot: 0,
    iconSnapshot: 'i',
  );
}

BlockTemplate template(int defaultDuration) {
  return BlockTemplate(
    id: 't1',
    name: '공부하기',
    color: 0xFF00FF00,
    icon: 'study',
    defaultDurationMinutes: defaultDuration,
    isSeed: true,
  );
}

void main() {
  final PlanDate d = PlanDate(2026, 8, 19);

  group('FR-05 블럭 배치', () {
    test('드롭 지점의 시각이 그대로 블럭의 시작 시각이 된다', () {
      final result = placeTemplate(
        template: template(60),
        date: d,
        dropMinuteRaw: 480,
        sameDayExisting: const <BlockInstance>[],
        nextDayExisting: const <BlockInstance>[],
        linkId: 'L1',
      );
      expect(result, isA<PlacementSuccess>());
      expect((result as PlacementSuccess).block.startMinute, 480);
    });

    test('기본 길이 60분 템플릿을 가용 공간 30분 지점에 드롭하면 30분 길이로 생성된다', () {
      final blocking = inst(d, 510, 60, id: 'blocking'); // 08:30 시작 -> 08:00부터 가용 30분
      final result = placeTemplate(
        template: template(60),
        date: d,
        dropMinuteRaw: 480,
        sameDayExisting: <BlockInstance>[blocking],
        nextDayExisting: const <BlockInstance>[],
        linkId: 'L1',
      );
      expect(result, isA<PlacementSuccess>());
      expect((result as PlacementSuccess).block.durationMinutes, 30);
    });

    test('가용 공간이 10분 미만인 지점에 드롭하면 블럭이 생성되지 않는다', () {
      final blocking = inst(d, 485, 60, id: 'blocking'); // 5분 뒤에 다음 블럭
      final result = placeTemplate(
        template: template(60),
        date: d,
        dropMinuteRaw: 480,
        sameDayExisting: <BlockInstance>[blocking],
        nextDayExisting: const <BlockInstance>[],
        linkId: 'L1',
      );
      expect(result, isA<PlacementRejectedInsufficientSpace>());
    });

    test('10:00~11:00 점유 상태에서 10:30 드롭은 즉시 거부된다', () {
      final existing = inst(d, 600, 60, id: 'existing');
      final result = placeTemplate(
        template: template(60),
        date: d,
        dropMinuteRaw: 630,
        sameDayExisting: <BlockInstance>[existing],
        nextDayExisting: const <BlockInstance>[],
        linkId: 'L1',
      );
      expect(result, isA<PlacementRejectedInvalidDropPoint>());
    });

    test('10:00~11:00 점유 상태에서 정확히 11:00 드롭은 유효하다', () {
      final existing = inst(d, 600, 60, id: 'existing');
      final result = placeTemplate(
        template: template(60),
        date: d,
        dropMinuteRaw: 660,
        sameDayExisting: <BlockInstance>[existing],
        nextDayExisting: const <BlockInstance>[],
        linkId: 'L1',
      );
      expect(result, isA<PlacementSuccess>());
    });

    test('드래그 중 미리보기 유효성은 배치 결과와 일치한다', () {
      final existing = inst(d, 600, 60, id: 'existing');
      expect(isPreviewDropValid(630, <BlockInstance>[existing]), isFalse);
      expect(isPreviewDropValid(660, <BlockInstance>[existing]), isTrue);
    });

    test('다음 날 인스턴스가 가용 길이를 제한한다 (자정 교차 산출)', () {
      final nextDay = inst(d.nextDay, 120, 30, id: 'nextday'); // 익일 02:00 시작
      final available = computeAvailableLength(1380, const <BlockInstance>[], <BlockInstance>[nextDay]);
      // 23:00 -> 자정까지 60분 + 익일 02:00까지 120분 = 180분
      expect(available, 180);
    });

    test('가용 길이는 최대 1440분으로 제한된다', () {
      final available = computeAvailableLength(700, const <BlockInstance>[], const <BlockInstance>[]);
      expect(available, 1440);
    });

    test('시작+길이가 1440을 넘으면 자정 교차로 판정된다', () {
      final result = placeTemplate(
        template: template(480),
        date: d,
        dropMinuteRaw: 1380,
        sameDayExisting: const <BlockInstance>[],
        nextDayExisting: const <BlockInstance>[],
        linkId: 'L1',
      );
      final block = (result as PlacementSuccess).block;
      expect(block.crossesMidnight, isTrue);
    });
  });
}

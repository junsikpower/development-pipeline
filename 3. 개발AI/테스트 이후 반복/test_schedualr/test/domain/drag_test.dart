import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

LogicalBlock sleepBlock() => LogicalBlock(
      linkId: 'L1',
      date: PlanDate(2026, 8, 19),
      startMinute: 1380, // 23:00
      durationMinutes: 480, // 07:00까지 (익일)
      nameSnapshot: '수면',
      colorSnapshot: 0,
      iconSnapshot: 'sleep',
    );

void main() {
  group('FR-07 몸통 드래그', () {
    test('몸통 드래그 시 블럭 길이가 변하지 않는다', () {
      final result = applyDrag(sleepBlock(), DragTarget.body, 30);
      expect(result.durationMinutes, sleepBlock().durationMinutes);
    });

    test('몸통 드래그로 블럭을 자정 경계 너머로 이동할 수 있다', () {
      // 23:00 -> +90분 = 00:30 (다음 날 순환 위치, start=30)
      final result = applyDrag(sleepBlock(), DragTarget.body, 90);
      expect(result.startMinute, 30);
    });
  });

  group('FR-07 (2) 누적 회전량 해석 — 핵심 규칙', () {
    // 23:00~07:00(480분) 블럭의 종료 핸들을 23:50 위치로 끄는 두 시나리오.
    test('반시계로 끌어온 경우 당일 23:50 종료(길이 50분)로 해석한다', () {
      // 원래 종료(다음날 07:00)에서 반시계로 07:10만큼 되돌아와 23:50에 도달
      const double delta = -430.0; // 07:10을 반시계로 되돌아옴
      final result = applyDrag(sleepBlock(), DragTarget.endHandle, delta);
      expect(result.durationMinutes, 50);
    });

    test('시계로 끌어온 경우 익일 23:50 종료 방향으로 해석하되 1440분 상한에서 정지한다', () {
      // 시계 방향으로 계속 전진 (예: +1000분)
      final double delta = 1000;
      final result = applyDrag(sleepBlock(), DragTarget.endHandle, delta);
      expect(result.durationMinutes, 1440); // 상한 정지
    });

    test('동일한 각도 위치라도 회전 방향에 따라 결과가 다르다', () {
      final ccw = applyDrag(sleepBlock(), DragTarget.endHandle, -430);
      final cw = applyDrag(sleepBlock(), DragTarget.endHandle, -430 + 1440);
      expect(ccw.durationMinutes, isNot(equals(cw.durationMinutes)));
    });
  });

  group('FR-07 (4) 시작 핸들 드래그', () {
    test('종료 시각(절대값)을 고정하고 시작만 변경한다', () {
      final LogicalBlock b = sleepBlock(); // start=1380, dur=480, end=1860
      final result = applyDrag(b, DragTarget.startHandle, 60); // 시계 방향 60분
      // start 상한(maxStartMinute=1430)에서 정지하며, duration은 반대로 줄어든다.
      expect(result.startMinute, 1430);
      expect(result.durationMinutes, 430);
      expect(result.startMinute + result.durationMinutes, 1860); // 절대 종료 고정
    });

    test('길이가 10분 미만으로 변경되지 않는다 (하한 정지)', () {
      final LogicalBlock b = sleepBlock(); // end=1860
      // start를 end-10 이상으로는 못감: 최대 start = 1850, 그러나 maxStartMinute=1430 제한도 있음
      final result = applyDrag(b, DragTarget.startHandle, 100000);
      expect(result.durationMinutes, greaterThanOrEqualTo(10));
      expect(result.startMinute, lessThanOrEqualTo(1430));
    });
  });

  group('FR-07 (5) 종료 핸들 드래그', () {
    test('시작 시각을 고정하고 길이만 변경한다', () {
      final LogicalBlock b = sleepBlock();
      final result = applyDrag(b, DragTarget.endHandle, 20);
      expect(result.startMinute, b.startMinute);
      expect(result.durationMinutes, 500);
    });

    test('길이가 10분 미만으로 줄지 않는다', () {
      final LogicalBlock b = sleepBlock();
      final result = applyDrag(b, DragTarget.endHandle, -100000);
      expect(result.durationMinutes, 10);
    });
  });

  group('스냅 (6)', () {
    test('조작 결과는 항상 10분 단위로 스냅된다', () {
      final LogicalBlock b = sleepBlock();
      final result = applyDrag(b, DragTarget.endHandle, 23); // 23분 이동 -> 스냅 필요
      expect(result.durationMinutes % 10, 0);
    });
  });
}

import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BR-01 시간 그리드', () {
    test('08:00 시작 60분 블럭은 정확히 15도의 호로 표시된다 (FR-03 AC)', () {
      expect(minutesToDegrees(480), 120.0); // 08:00 = 480분
      expect(minutesToDegrees(60), 15.0); // 60분 길이 = 15도
    });

    test('10분은 2.5도이다', () {
      expect(minutesToDegrees(10), 2.5);
    });

    test('snapToGrid는 가장 가까운 10분 배수로 반올림한다', () {
      expect(snapToGrid(123), 120);
      expect(snapToGrid(125), 130); // 반올림 경계는 올림
      expect(snapToGrid(126), 130);
    });

    test('wrapMinuteOfDay는 음수를 하루 범위로 정규화한다', () {
      expect(wrapMinuteOfDay(-10), 1430);
      expect(wrapMinuteOfDay(1450), 10);
      expect(wrapMinuteOfDay(1440), 0);
      expect(wrapMinuteOfDay(0), 0);
    });

    test('isOnGrid는 10분 배수만 참이다', () {
      expect(isOnGrid(10), isTrue);
      expect(isOnGrid(15), isFalse);
    });
  });
}

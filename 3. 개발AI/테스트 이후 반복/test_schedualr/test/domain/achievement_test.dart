import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BR-09 캘린더 마커 표현', () {
    test('달성률 0% -> 불투명도 0.30', () {
      expect(dotOpacityFor(0.0), closeTo(0.30, 1e-9));
    });
    test('달성률 50% -> 불투명도 0.65', () {
      expect(dotOpacityFor(0.5), closeTo(0.65, 1e-9));
    });
    test('달성률 100% -> 불투명도 1.00', () {
      expect(dotOpacityFor(1.0), closeTo(1.00, 1e-9));
    });
  });

  group('FR-14 (3) 달성률 산출', () {
    test('논리 블럭 수가 0인 날짜의 달성률은 정의되지 않는다', () {
      expect(computeAchievementRate(0, 0), isNull);
      expect(dotOpacityForCounts(0, 0), isNull);
    });

    test('전체 논리 블럭을 완료한 날짜의 도트가 최고 불투명도로 표시된다', () {
      expect(computeAchievementRate(3, 3), 1.0);
      expect(dotOpacityForCounts(3, 3), closeTo(1.0, 1e-9));
    });

    test('달성률 0%인 날과 100%인 날은 서로 다른 불투명도를 갖는다', () {
      final zero = dotOpacityForCounts(0, 4)!;
      final full = dotOpacityForCounts(4, 4)!;
      expect(zero, isNot(equals(full)));
    });
  });
}

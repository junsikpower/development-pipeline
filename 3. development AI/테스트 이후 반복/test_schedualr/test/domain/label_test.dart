import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BR-08 협소 블럭 표기 축약', () {
    test('충분한 길이면 명칭+아이콘을 표시한다', () {
      final mode = decideLabelMode(
        arcLength: 200,
        nameWidth: 80,
        iconWidth: 20,
        padding: 10,
      );
      expect(mode, LabelMode.nameAndIcon);
    });

    test('명칭은 안 들어가지만 아이콘은 들어가면 아이콘만 표시한다', () {
      final mode = decideLabelMode(
        arcLength: 25,
        nameWidth: 80,
        iconWidth: 20,
        padding: 5,
      );
      expect(mode, LabelMode.iconOnly);
    });

    test('아이콘조차 들어가지 않으면 색상만 표시한다', () {
      final mode = decideLabelMode(
        arcLength: 5,
        nameWidth: 80,
        iconWidth: 20,
        padding: 10,
      );
      expect(mode, LabelMode.colorOnly);
    });

    test('판정 기준은 고정 분값이 아닌 실제 렌더링 길이(호 중심선)이다', () {
      // 동일 각도(theta)라도 반지름이 커지면 호 길이가 늘어나 표기 단계가 달라진다.
      const double theta = 0.5; // rad, 동일한 블럭 각도
      final double shortArc = arcMidLength(50, theta);
      final double longArc = arcMidLength(500, theta);
      expect(longArc, greaterThan(shortArc));

      final smallScreenMode = decideLabelMode(
        arcLength: shortArc,
        nameWidth: 80,
        iconWidth: 20,
        padding: 10,
      );
      final largeScreenMode = decideLabelMode(
        arcLength: longArc,
        nameWidth: 80,
        iconWidth: 20,
        padding: 10,
      );
      expect(smallScreenMode, LabelMode.colorOnly);
      expect(largeScreenMode, LabelMode.nameAndIcon);
    });
  });
}

import 'package:circular_scheduler/domain/domain.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BR-10 터치 판정', () {
    test('L=10인 블럭은 양쪽에 각 17씩 추가되어 총 44가 된다 (양쪽에 44씩 더하지 않음)', () {
      final region = TouchRegion(id: 'a', originalStart: 100, originalEnd: 110, isHandle: false);
      final expanded = expandTouchRegion(region, 44);
      expect(expanded.expandedEnd - expanded.expandedStart, 44);
      expect(expanded.expandedStart, 100 - 17);
      expect(expanded.expandedEnd, 110 + 17);
    });

    test('충분히 긴 블럭은 확장되지 않는다', () {
      final region = TouchRegion(id: 'a', originalStart: 0, originalEnd: 100, isHandle: false);
      final expanded = expandTouchRegion(region, 44);
      expect(expanded.expandedStart, 0);
      expect(expanded.expandedEnd, 100);
    });

    test('길이 10분인 블럭을 탭했을 때 선택된다', () {
      final region = TouchRegion(id: 'block', originalStart: 480, originalEnd: 490, isHandle: false);
      final picked = pickRegionAt(485, <TouchRegion>[region], 44);
      expect(picked, 'block');
    });

    test('인접한 두 블럭의 경계 부근을 탭했을 때 더 가까운 쪽이 선택된다', () {
      // A: 0~10 (짧아서 확장), B: 10~100 (충분히 김)
      final a = TouchRegion(id: 'A', originalStart: 0, originalEnd: 10, isHandle: false);
      final b = TouchRegion(id: 'B', originalStart: 10, originalEnd: 100, isHandle: false);
      // 터치 지점 12는 B 내부이자 A의 확장 영역에도 걸칠 수 있음. B에 더 가깝다(거리 0).
      final picked = pickRegionAt(12, <TouchRegion>[a, b], 44);
      expect(picked, 'B');
    });

    test('핸들의 터치 영역은 몸통보다 우선 판정된다', () {
      final body = TouchRegion(id: 'body', originalStart: 0, originalEnd: 100, isHandle: false);
      final handle = TouchRegion(id: 'handle', originalStart: 45, originalEnd: 55, isHandle: true);
      final picked = pickRegionAt(50, <TouchRegion>[body, handle], 44);
      expect(picked, 'handle');
    });

    test('블럭이 배치되지 않은 영역의 터치는 선택 해제(null)로 처리된다', () {
      final region = TouchRegion(id: 'a', originalStart: 0, originalEnd: 10, isHandle: false);
      final picked = pickRegionAt(500, <TouchRegion>[region], 44);
      expect(picked, isNull);
    });
  });
}

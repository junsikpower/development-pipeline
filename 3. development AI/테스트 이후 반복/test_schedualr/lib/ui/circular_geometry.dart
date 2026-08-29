/// 원형 계획표 좌표 변환 — FR-03 (1): 0시는 12시 방향, 시계 방향 진행.
library;

import 'dart:math' as math;
import 'dart:ui';

import '../domain/time_grid.dart';

/// 분을 캔버스 각도(라디안, 3시 방향이 0, 시계 방향이 양수)로 변환한다.
double minuteToCanvasAngle(num minute) {
  final double fraction = minute / minutesPerDay;
  return -math.pi / 2 + fraction * 2 * math.pi;
}

/// 중심 [center]로부터 [radius], [minute] 위치의 좌표.
Offset pointForMinute(Offset center, double radius, num minute) {
  final double angle = minuteToCanvasAngle(minute);
  return Offset(
    center.dx + radius * math.cos(angle),
    center.dy + radius * math.sin(angle),
  );
}

/// 화면 좌표 [point]를 [center] 기준 원시 분(스냅 전, 0~1440 미만)으로 변환한다.
double minuteForPoint(Offset point, Offset center) {
  final double dx = point.dx - center.dx;
  final double dy = point.dy - center.dy;
  double angle = math.atan2(dy, dx) + math.pi / 2;
  if (angle < 0) angle += 2 * math.pi;
  if (angle >= 2 * math.pi) angle -= 2 * math.pi;
  return (angle / (2 * math.pi)) * minutesPerDay;
}

/// [point]의 중심으로부터의 거리.
double distanceFromCenter(Offset point, Offset center) => (point - center).distance;

/// 두 각도(분 단위, 0~1440) 사이의 부호 있는 최단 회전량을 계산한다.
/// TD-13의 "누적 회전량" 구현에 쓰인다: 매 프레임 최단 증분을 누적하면
/// 자정 경계(0/1440)를 넘나들어도 방향이 뒤집히지 않는다.
double shortestSignedDeltaMinutes(double fromMinute, double toMinute) {
  double delta = (toMinute - fromMinute) % minutesPerDay;
  if (delta > minutesPerDay / 2) delta -= minutesPerDay;
  if (delta < -minutesPerDay / 2) delta += minutesPerDay;
  return delta;
}

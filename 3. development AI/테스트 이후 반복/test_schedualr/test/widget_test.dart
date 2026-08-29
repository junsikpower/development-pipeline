// 순수 렌더링 스모크 테스트: 위젯 트리/DB/플러그인 채널 없이 CustomPainter를
// 직접 구동해 다양한 블럭 구성(자정 교차, 겹침 경고, 협소 블럭 축약)에서
// 페인팅이 예외 없이 완료되는지 검증한다.

import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';

import 'package:circular_scheduler/domain/domain.dart';
import 'package:circular_scheduler/ui/circular_ring_painter.dart';
import 'package:circular_scheduler/ui/visual_block.dart';

LogicalBlock lb(PlanDate date, int start, int dur, {String name = 'n'}) {
  return LogicalBlock(
    linkId: 'L_$start',
    date: date,
    startMinute: start,
    durationMinutes: dur,
    nameSnapshot: name,
    colorSnapshot: 0xFF4285F4,
    iconSnapshot: 'i',
    instanceIds: const <String>['i1'],
    isPersisted: true,
  );
}

void _paintAndDiscard(CircularRingPainter painter, Size size) {
  final PictureRecorder recorder = PictureRecorder();
  final Canvas canvas = Canvas(recorder);
  painter.paint(canvas, size);
  recorder.endRecording().dispose();
}

void main() {
  const Size size = Size(320, 320);
  final PlanDate d = PlanDate(2026, 8, 19);

  test('일반 블럭 렌더링이 예외 없이 완료된다', () {
    final visuals = buildVisualBlocks(d, [lb(d, 480, 60, name: '공부하기')]);
    _paintAndDiscard(
      CircularRingPainter(blocks: visuals, selectedKey: null, trackThickness: 28),
      size,
    );
  });

  test('자정 교차 블럭(연속 표식 포함) 렌더링이 예외 없이 완료된다', () {
    final visuals = buildVisualBlocks(d, [lb(d, 1380, 480, name: '수면')]);
    expect(visuals.first.continuationAtEnd, isTrue);
    _paintAndDiscard(
      CircularRingPainter(blocks: visuals, selectedKey: visuals.first.key, trackThickness: 28),
      size,
    );
  });

  test('겹침 경고(isConflict) 렌더링이 예외 없이 완료된다', () {
    final visuals = buildVisualBlocks(d, [lb(d, 480, 30)]);
    final conflictVisuals = [for (final v in visuals) v.copyWith(isConflict: true)];
    _paintAndDiscard(
      CircularRingPainter(blocks: conflictVisuals, selectedKey: null, trackThickness: 28),
      size,
    );
  });

  test('협소 블럭(10분) 축약 표기 렌더링이 예외 없이 완료된다 (BR-08)', () {
    final visuals = buildVisualBlocks(d, [lb(d, 480, 10, name: '아주긴이름의블럭명칭')]);
    _paintAndDiscard(
      CircularRingPainter(blocks: visuals, selectedKey: null, trackThickness: 28),
      size,
    );
  });

  test('여러 블럭이 동시에 있어도 렌더링이 예외 없이 완료된다', () {
    final visuals = buildVisualBlocks(d, [
      lb(d, 0, 480, name: '잠자기'),
      lb(d, 480, 30, name: '씻기'),
      lb(d, 510, 30, name: '밥먹기'),
    ]);
    _paintAndDiscard(
      CircularRingPainter(blocks: visuals, selectedKey: visuals.last.key, trackThickness: 28),
      size,
    );
  });
}

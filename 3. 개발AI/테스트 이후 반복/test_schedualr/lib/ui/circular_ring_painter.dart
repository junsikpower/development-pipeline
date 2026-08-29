/// 24시간 단일 링 렌더링 — FR-03, BR-08, TD-02.
library;

import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../domain/domain.dart';
import 'circular_geometry.dart';
import 'visual_block.dart';

const double kMinTouchDp = 44.0;

class CircularRingPainter extends CustomPainter {
  CircularRingPainter({
    required this.blocks,
    required this.selectedKey,
    required this.trackThickness,
  });

  final List<VisualBlock> blocks;
  final String? selectedKey;
  final double trackThickness;

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = size.center(Offset.zero);
    final double outerRadius = math.min(size.width, size.height) / 2 - 4;
    final double midRadius = outerRadius - trackThickness / 2;

    final Paint trackPaint = Paint()
      ..color = Colors.grey.withValues(alpha: 0.15)
      ..style = PaintingStyle.stroke
      ..strokeWidth = trackThickness;
    canvas.drawCircle(center, midRadius, trackPaint);

    for (final VisualBlock block in blocks) {
      _paintArc(canvas, center, midRadius, block);
    }

    for (final VisualBlock block in blocks) {
      if (block.key != selectedKey) continue;
      _paintHandles(canvas, center, outerRadius, block);
    }
  }

  void _paintArc(Canvas canvas, Offset center, double midRadius, VisualBlock block) {
    final double startAngle = minuteToCanvasAngle(block.segmentStart);
    final double sweep =
        minuteToCanvasAngle(block.segmentEnd) - minuteToCanvasAngle(block.segmentStart);
    final bool isSelected = block.key == selectedKey;

    final Color color = block.isConflict
        ? Colors.red
        : Color(block.logical.colorSnapshot).withValues(
            alpha: block.logical.isCompleted ? 0.45 : 1.0,
          );

    final Paint arcPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = isSelected ? trackThickness + 6 : trackThickness
      ..strokeCap = StrokeCap.butt;

    final Rect rect = Rect.fromCircle(center: center, radius: midRadius);
    canvas.drawArc(rect, startAngle, sweep, false, arcPaint);

    final double midMinute = (block.segmentStart + block.segmentEnd) / 2;
    final double arcLength =
        midRadius * (sweep.abs());
    _paintLabel(canvas, center, midRadius, midMinute, arcLength, block);

    if (block.continuationAtStart) {
      _paintContinuationMarker(canvas, center, midRadius, block.segmentStart);
    }
    if (block.continuationAtEnd) {
      _paintContinuationMarker(canvas, center, midRadius, block.segmentEnd);
    }
  }

  void _paintLabel(
    Canvas canvas,
    Offset center,
    double midRadius,
    double midMinute,
    double arcLength,
    VisualBlock block,
  ) {
    const double iconWidth = 18;
    const double padding = 8;
    final TextPainter tp = TextPainter(
      text: TextSpan(
        text: block.logical.nameSnapshot,
        style: const TextStyle(color: Colors.white, fontSize: 11),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    final LabelMode mode = decideLabelMode(
      arcLength: arcLength,
      nameWidth: tp.width,
      iconWidth: iconWidth,
      padding: padding,
    );

    if (mode == LabelMode.colorOnly) return;

    final Offset labelPos = pointForMinute(center, midRadius, midMinute);
    if (mode == LabelMode.nameAndIcon) {
      tp.paint(canvas, labelPos - Offset(tp.width / 2, tp.height / 2));
    } else {
      final Paint dot = Paint()..color = Colors.white;
      canvas.drawCircle(labelPos, 3, dot);
    }
  }

  void _paintContinuationMarker(Canvas canvas, Offset center, double midRadius, int minute) {
    final Offset p = pointForMinute(center, midRadius, minute);
    final Paint marker = Paint()..color = Colors.white;
    canvas.drawCircle(p, 3, marker);
  }

  void _paintHandles(Canvas canvas, Offset center, double outerRadius, VisualBlock block) {
    final Paint handlePaint = Paint()..color = Colors.black87;
    // 자정 연속 지점도 실제 반대쪽 끝 지점과 같은 각도이므로 핸들을 그대로
    // 표시한다 — 다른 날짜 화면으로 이동하지 않고 두 지점 모두 조작 가능.
    canvas.drawCircle(pointForMinute(center, outerRadius, block.segmentStart), 6, handlePaint);
    canvas.drawCircle(pointForMinute(center, outerRadius, block.segmentEnd), 6, handlePaint);
  }

  @override
  bool shouldRepaint(covariant CircularRingPainter oldDelegate) =>
      oldDelegate.blocks != blocks || oldDelegate.selectedKey != selectedKey;
}

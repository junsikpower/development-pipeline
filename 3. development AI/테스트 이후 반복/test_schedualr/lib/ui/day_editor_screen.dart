/// 날짜별 원형 계획표 편집 화면 — FR-02~FR-14.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../data/id_generator.dart';
import '../data/plan_repository.dart';
import '../domain/domain.dart' hide DragTarget;
import '../domain/drag.dart' as drag_op;
import '../services/app_services.dart';
import 'circular_geometry.dart';
import 'circular_ring_painter.dart';
import 'visual_block.dart';

enum _DragMode { none, body, startHandle, endHandle }

class DayEditorScreen extends StatefulWidget {
  const DayEditorScreen({super.key, required this.date});
  final PlanDate date;

  @override
  State<DayEditorScreen> createState() => _DayEditorScreenState();
}

class _DayEditorScreenState extends State<DayEditorScreen> {
  final GlobalKey _ringKey = GlobalKey();
  final IdGenerator _ids = IdGenerator();

  List<LogicalBlock> _blocks = <LogicalBlock>[];
  List<LogicalBlock> _original = <LogicalBlock>[];
  final Set<String> _deletedKeys = <String>{};
  List<BlockTemplate> _templates = <BlockTemplate>[];

  String? _selectedKey;
  bool _loading = true;

  _DragMode _dragMode = _DragMode.none;
  LogicalBlock? _dragOriginal;
  LogicalBlock? _previewDragBlock;
  double _cumulativeDelta = 0;
  double _lastMinute = 0;
  bool _dragConflict = false;

  int? _previewDropMinute;
  int? _previewDropLength;
  bool _previewDropValid = true;
  BlockTemplate? _draggingTemplate;

  bool get _isDragging => _dragMode != _DragMode.none;

  bool _initialized = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_initialized) {
      _initialized = true;
      _load();
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final repo = AppServices.of(context).repository;
    final blocks = await repo.getLogicalBlocksTouchingDate(widget.date);
    final templates = await repo.getAllTemplates();
    if (!mounted) return;
    setState(() {
      _blocks = blocks;
      _original = List<LogicalBlock>.of(blocks);
      _deletedKeys.clear();
      _templates = templates;
      _selectedKey = null;
      _loading = false;
    });
  }

  bool get _isDirty {
    if (_deletedKeys.isNotEmpty) return true;
    if (_blocks.length != _original.length) return true;
    final Map<String, LogicalBlock> originalByKey = {
      for (final b in _original) b.linkId: b,
    };
    for (final b in _blocks) {
      final LogicalBlock? o = originalByKey[b.linkId];
      if (o == null) return true;
      if (o.date != b.date ||
          o.startMinute != b.startMinute ||
          o.durationMinutes != b.durationMinutes ||
          o.preNotifyMinutes != b.preNotifyMinutes) {
        return true;
      }
    }
    return false;
  }

  List<VisualBlock> _visualBlocks() {
    final List<LogicalBlock> display = <LogicalBlock>[
      for (final b in _blocks)
        if (_previewDragBlock != null && b.linkId == _dragOriginal?.linkId)
          _previewDragBlock!
        else
          b,
    ];
    final List<VisualBlock> visuals = buildVisualBlocks(widget.date, display);
    if (_dragConflict && _dragOriginal != null) {
      return [
        for (final v in visuals)
          if (v.key == _dragOriginal!.linkId) v.copyWith(isConflict: true) else v,
      ];
    }
    return visuals;
  }

  // -------------------------------------------------------------------
  // 저장 / 이탈 (FR-10)
  // -------------------------------------------------------------------

  Future<void> _save() async {
    final repo = AppServices.of(context).repository;
    try {
      await repo.saveLogicalBlocks(upserts: _blocks, deletedKeys: _deletedKeys.toList());
    } on OverlapViolationException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('겹치는 시간대가 있어 저장할 수 없습니다.')),
      );
      return;
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('저장에 실패했습니다. 편집 내용은 유지됩니다.'),
          action: SnackBarAction(label: '재시도', onPressed: _save),
        ),
      );
      return;
    }
    if (!mounted) return;
    try {
      await AppServices.of(context).refreshNotificationSchedule();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('계획은 저장되었으나 알림 예약에 실패했습니다.')),
        );
      }
    }
    if (!mounted) return;
    setState(() {
      _original = List<LogicalBlock>.of(_blocks);
      _deletedKeys.clear();
    });
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('저장되었습니다.')));
  }

  Future<bool> _confirmLeaveIfDirty() async {
    if (!_isDirty) return true;
    final bool? leave = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('저장하지 않고 나가시겠습니까?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('나가기'),
          ),
        ],
      ),
    );
    return leave ?? false;
  }

  // -------------------------------------------------------------------
  // 완료 체크 (FR-14) — 즉시 커밋, Dirty 무관
  // -------------------------------------------------------------------

  Future<void> _toggleCompletion() async {
    final LogicalBlock? sel = _selected();
    if (sel == null || !sel.isPersisted) return;
    final bool newValue = !sel.isCompleted;
    final String repId = sel.instanceIds.isNotEmpty ? sel.instanceIds.first : sel.linkId;
    await AppServices.of(context).repository.setCompletion(repId, newValue);
    setState(() {
      _blocks = [
        for (final b in _blocks)
          if (b.linkId == sel.linkId) b.copyWith(isCompleted: newValue) else b,
      ];
      _original = [
        for (final b in _original)
          if (b.linkId == sel.linkId) b.copyWith(isCompleted: newValue) else b,
      ];
    });
  }

  void _deleteSelected() {
    final LogicalBlock? sel = _selected();
    if (sel == null) return;
    setState(() {
      _blocks.removeWhere((b) => b.linkId == sel.linkId);
      if (sel.isPersisted) _deletedKeys.add(sel.linkId);
      _selectedKey = null;
    });
  }

  Future<void> _openNotificationSettings() async {
    final LogicalBlock? sel = _selected();
    if (sel == null) return;
    final int? choice = await showModalBottomSheet<int?>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            RadioListTile<int?>(
              title: const Text('사전 알림 없음'),
              value: null,
              groupValue: sel.preNotifyMinutes,
              onChanged: (v) => Navigator.pop(ctx, v),
            ),
            RadioListTile<int?>(
              title: const Text('5분 전'),
              value: 5,
              groupValue: sel.preNotifyMinutes,
              onChanged: (v) => Navigator.pop(ctx, v),
            ),
            RadioListTile<int?>(
              title: const Text('10분 전'),
              value: 10,
              groupValue: sel.preNotifyMinutes,
              onChanged: (v) => Navigator.pop(ctx, v),
            ),
          ],
        ),
      ),
    );
    setState(() {
      _blocks = [
        for (final b in _blocks)
          if (b.linkId == sel.linkId)
            b.copyWith(preNotifyMinutes: choice, clearPreNotify: choice == null)
          else
            b,
      ];
    });
  }

  LogicalBlock? _selected() {
    if (_selectedKey == null) return null;
    for (final b in _blocks) {
      if (b.linkId == _selectedKey) return b;
    }
    return null;
  }

  // -------------------------------------------------------------------
  // 다른 날짜 계획 복사 (FR-13) — 세션에만 반영, DB 확정은 저장 버튼 (FR-13 (5))
  // -------------------------------------------------------------------

  Future<void> _copyFromOtherDate() async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: widget.date.toDateTime().subtract(const Duration(days: 1)),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      helpText: '불러올 날짜 선택',
    );
    if (picked == null || !mounted) return;
    final PlanDate source = PlanDate.fromDateTime(picked);

    if (_blocks.isNotEmpty) {
      final bool? proceed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('기존 계획을 덮어씁니다'),
          content: const Text('이 날짜의 기존 계획이 모두 삭제되고 선택한 날짜의 계획으로 교체됩니다.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('교체')),
          ],
        ),
      );
      if (proceed != true) return;
    }

    final repo = AppServices.of(context).repository;
    final sourceInstances = await repo.getInstancesForDate(source);
    final sourceLogical =
        rebuildLogicalBlocks(sourceInstances).where((b) => b.date == source).toList();
    final targetNextDayExisting = await repo.getInstancesForDate(widget.date.nextDay);

    final CopyDayResult result = copyDayPlan(
      sourceDate: source,
      targetDate: widget.date,
      sourceBlocks: sourceLogical,
      targetNextDayExisting: targetNextDayExisting,
      idFactory: _ids.next,
    );

    if (!mounted) return;
    setState(() {
      for (final b in _blocks) {
        if (b.isPersisted) _deletedKeys.add(b.linkId);
      }
      _blocks = result.createdBlocks;
      _selectedKey = null;
    });

    if (result.hasExclusions) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('다음 블럭은 다음 날 일정과 겹쳐 제외되었습니다: ${result.excludedBlockNames.join(", ")}')),
      );
    }
  }

  // -------------------------------------------------------------------
  // 제스처 (FR-03 (4), FR-06, FR-07, BR-10, TD-13)
  // -------------------------------------------------------------------

  Offset _center(Size size) => size.center(Offset.zero);

  double _midRadius(Size size) => math.min(size.width, size.height) / 2 - 4 - 12;

  double _minTouchMinutes(double midRadius) =>
      (kMinTouchDp / (2 * math.pi * midRadius)) * minutesPerDay;

  void _onPanStart(DragStartDetails details, Size size) {
    final Offset center = _center(size);
    final double midRadius = _midRadius(size);
    final Offset local = details.localPosition;

    final List<VisualBlock> visuals = _visualBlocks();

    if (_selectedKey != null) {
      final VisualBlock? sel = _findVisual(visuals, _selectedKey!);
      if (sel != null) {
        final double outerRadius = midRadius + 12;
        // 자정 연속 지점(0분/1440분)은 화면상 12시 위치로, 물리적으로는
        // 실제 끝 지점과 동일한 각도다. 연속 표식이 있어도 핸들을 그대로
        // 노출해, 다른 날짜 화면으로 이동하지 않고도 두 지점을 조작할 수
        // 있게 한다(FR-07 어느 쪽 핸들을 조작하든 두 인스턴스 길이 합이
        // 총 길이와 일치해야 한다는 요구를 만족).
        final Offset endPoint = pointForMinute(center, outerRadius, sel.segmentEnd);
        if (distanceFromCenter(local, endPoint) <= 22) {
          _beginDrag(_DragMode.endHandle, sel.logical, local, center);
          return;
        }
        final Offset startPoint = pointForMinute(center, outerRadius, sel.segmentStart);
        if (distanceFromCenter(local, startPoint) <= 22) {
          _beginDrag(_DragMode.startHandle, sel.logical, local, center);
          return;
        }
      }
    }

    final double touchMinute = minuteForPoint(local, center);
    final List<TouchRegion> regions = [
      for (final v in visuals)
        TouchRegion(
          id: v.key,
          originalStart: v.segmentStart.toDouble(),
          originalEnd: v.segmentEnd.toDouble(),
          isHandle: false,
        ),
    ];
    final String? picked = pickRegionAt(touchMinute, regions, _minTouchMinutes(midRadius));
    if (picked == null) {
      setState(() => _selectedKey = null);
      return;
    }
    setState(() => _selectedKey = picked);
    final LogicalBlock target = _blocks.firstWhere((b) => b.linkId == picked);
    _beginDrag(_DragMode.body, target, local, center);
  }

  VisualBlock? _findVisual(List<VisualBlock> visuals, String key) {
    for (final v in visuals) {
      if (v.key == key) return v;
    }
    return null;
  }

  void _beginDrag(_DragMode mode, LogicalBlock target, Offset local, Offset center) {
    setState(() {
      _dragMode = mode;
      _dragOriginal = target;
      _previewDragBlock = target;
      _cumulativeDelta = 0;
      _lastMinute = minuteForPoint(local, center);
      _dragConflict = false;
    });
  }

  void _onPanUpdate(DragUpdateDetails details, Size size) {
    if (_dragMode == _DragMode.none || _dragOriginal == null) return;
    final Offset center = _center(size);
    final double nowMinute = minuteForPoint(details.localPosition, center);
    final double incremental = shortestSignedDeltaMinutes(_lastMinute, nowMinute);
    _cumulativeDelta += incremental;
    _lastMinute = nowMinute;

    final drag_op.DragTarget target = switch (_dragMode) {
      _DragMode.body => drag_op.DragTarget.body,
      _DragMode.startHandle => drag_op.DragTarget.startHandle,
      _DragMode.endHandle => drag_op.DragTarget.endHandle,
      _DragMode.none => drag_op.DragTarget.body,
    };

    final LogicalBlock candidate = applyDrag(_dragOriginal!, target, _cumulativeDelta);

    int tmp = 0;
    String tempId() => 'tmp_${tmp++}';
    final others = _blocks.where((b) => b.linkId != _dragOriginal!.linkId);
    final otherInstances = <BlockInstance>[
      for (final b in others) ...splitLogicalBlock(b, idFactory: tempId),
    ];
    final candidateInstances = splitLogicalBlock(candidate, idFactory: tempId);
    final bool conflict = validateNoOverlap(candidateInstances, otherInstances).hasConflict;

    setState(() {
      _previewDragBlock = candidate;
      _dragConflict = conflict;
    });
  }

  void _onPanEnd(DragEndDetails details) {
    if (_dragMode == _DragMode.none || _dragOriginal == null) return;
    setState(() {
      if (!_dragConflict && _previewDragBlock != null) {
        final LogicalBlock committed = _previewDragBlock!;
        _blocks = [
          for (final b in _blocks)
            if (b.linkId == _dragOriginal!.linkId) committed else b,
        ];
      }
      _dragMode = _DragMode.none;
      _dragOriginal = null;
      _previewDragBlock = null;
      _dragConflict = false;
    });
  }

  // -------------------------------------------------------------------
  // 배치 (FR-05, TD-14)
  // -------------------------------------------------------------------

  void _onDragTemplateMove(BlockTemplate template, Offset globalPosition, Size size) {
    final RenderBox? box = _ringKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null) return;
    final Offset local = box.globalToLocal(globalPosition);
    final Offset center = _center(size);
    final double dropMinuteRaw = minuteForPoint(local, center);

    final same = _instancesForDate(widget.date);
    final valid = isPreviewDropValid(dropMinuteRaw, same);
    final int startMinute = wrapMinuteOfDay(snapToGrid(dropMinuteRaw));
    final int length = valid
        ? math.min(
            template.defaultDurationMinutes,
            computeAvailableLength(startMinute, same, _instancesForDate(widget.date.nextDay)),
          )
        : 10;

    setState(() {
      _draggingTemplate = template;
      _previewDropMinute = startMinute;
      _previewDropLength = length;
      _previewDropValid = valid && length >= minDurationMinutes;
    });
  }

  void _onDragTemplateLeave() {
    setState(() {
      _draggingTemplate = null;
      _previewDropMinute = null;
      _previewDropLength = null;
    });
  }

  void _onDropTemplate(BlockTemplate template, Offset globalPosition, Size size) {
    final RenderBox? box = _ringKey.currentContext?.findRenderObject() as RenderBox?;
    _onDragTemplateLeave();
    if (box == null) return;
    final Offset local = box.globalToLocal(globalPosition);
    final Offset center = _center(size);
    final double dropMinuteRaw = minuteForPoint(local, center);

    final result = placeTemplate(
      template: template,
      date: widget.date,
      dropMinuteRaw: dropMinuteRaw,
      sameDayExisting: _instancesForDate(widget.date),
      nextDayExisting: _instancesForDate(widget.date.nextDay),
      linkId: _ids.next(),
    );

    if (result is PlacementSuccess) {
      setState(() {
        _blocks = [..._blocks, result.block];
        _selectedKey = result.block.linkId;
      });
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('이 위치에는 블럭을 놓을 수 없습니다.')),
      );
    }
  }

  List<BlockInstance> _instancesForDate(PlanDate date) {
    int tmp = 0;
    String tempId() => 'tmp_${tmp++}';
    return [
      for (final b in _blocks)
        ...splitLogicalBlock(b, idFactory: tempId).where((i) => i.date == date),
    ];
  }

  // -------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _confirmLeaveIfDirty() && mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text('${widget.date.year}.${widget.date.month}.${widget.date.day}'),
          actions: [
            IconButton(
              icon: const Icon(Icons.content_copy),
              tooltip: '다른 날짜에서 불러오기',
              onPressed: _copyFromOtherDate,
            ),
            TextButton.icon(
              onPressed: _save,
              icon: const Icon(Icons.save_outlined),
              label: const Text('저장'),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(
                children: [
                  Expanded(child: _buildRingArea()),
                  if (_selectedKey != null && !_isDragging) _buildActionBar(),
                  _buildLibraryPanel(),
                ],
              ),
      ),
    );
  }

  Widget _buildRingArea() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final Size size = Size(constraints.maxWidth, constraints.maxHeight);
        return DragTarget<BlockTemplate>(
          onWillAcceptWithDetails: (details) => true,
          onMove: (details) => _onDragTemplateMove(details.data, details.offset, size),
          onLeave: (_) => _onDragTemplateLeave(),
          onAcceptWithDetails: (details) => _onDropTemplate(details.data, details.offset, size),
          builder: (context, candidateData, rejectedData) {
            return GestureDetector(
              onPanStart: (d) => _onPanStart(d, size),
              onPanUpdate: (d) => _onPanUpdate(d, size),
              onPanEnd: _onPanEnd,
              child: CustomPaint(
                key: _ringKey,
                size: size,
                painter: CircularRingPainter(
                  blocks: _visualBlocks(),
                  selectedKey: _selectedKey,
                  trackThickness: 28,
                ),
                foregroundPainter: _draggingTemplate != null && _previewDropMinute != null
                    ? _PreviewPainter(
                        startMinute: _previewDropMinute!,
                        lengthMinutes: _previewDropLength ?? 10,
                        valid: _previewDropValid,
                      )
                    : null,
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildActionBar() {
    final LogicalBlock? sel = _selected();
    if (sel == null) return const SizedBox.shrink();
    return Material(
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            IconButton(
              icon: Icon(sel.isCompleted ? Icons.check_circle : Icons.check_circle_outline),
              onPressed: sel.isPersisted ? _toggleCompletion : null,
              tooltip: '완료 체크',
            ),
            IconButton(
              icon: const Icon(Icons.notifications_outlined),
              onPressed: _openNotificationSettings,
              tooltip: '알림 설정',
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: _deleteSelected,
              tooltip: '삭제',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLibraryPanel() {
    return Container(
      height: 96,
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: Colors.grey.shade300)),
      ),
      child: Row(
        children: [
          Expanded(
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final t in _templates) _TemplateChip(template: t),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.add_circle_outline),
            onPressed: _createCustomTemplate,
            tooltip: '블럭 추가',
          ),
        ],
      ),
    );
  }

  Future<void> _createCustomTemplate() async {
    final nameController = TextEditingController();
    int duration = 30;
    int color = 0xFF607D8B;
    const List<int> palette = [
      0xFFEF5350, 0xFFFFCA28, 0xFF66BB6A, 0xFF29B6F6, 0xFFAB47BC, 0xFF8D6E63,
    ];

    final BlockTemplate? created = await showDialog<BlockTemplate>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('블럭 추가'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: nameController, decoration: const InputDecoration(labelText: '명칭')),
              Row(
                children: [
                  for (final c in palette)
                    GestureDetector(
                      onTap: () => setDialogState(() => color = c),
                      child: Container(
                        margin: const EdgeInsets.all(4),
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: Color(c),
                          shape: BoxShape.circle,
                          border: color == c ? Border.all(width: 2) : null,
                        ),
                      ),
                    ),
                ],
              ),
              Row(
                children: [
                  const Text('기본 길이(분): '),
                  Expanded(
                    child: Slider(
                      min: 10,
                      max: 240,
                      divisions: 23,
                      value: duration.toDouble(),
                      label: '$duration',
                      onChanged: (v) => setDialogState(() => duration = snapToGrid(v)),
                    ),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
            TextButton(
              onPressed: () {
                if (nameController.text.trim().isEmpty) return;
                Navigator.pop(
                  ctx,
                  BlockTemplate(
                    id: AppServices.of(context).repository.newTemplateId(),
                    name: nameController.text.trim(),
                    color: color,
                    icon: 'more_horiz',
                    defaultDurationMinutes: duration,
                    isSeed: false,
                  ),
                );
              },
              child: const Text('생성'),
            ),
          ],
        ),
      ),
    );

    if (created == null) return;
    await AppServices.of(context).repository.upsertTemplate(created);
    if (!mounted) return;
    setState(() => _templates = [..._templates, created]);
  }
}

class _TemplateChip extends StatelessWidget {
  const _TemplateChip({required this.template});
  final BlockTemplate template;

  @override
  Widget build(BuildContext context) {
    return Draggable<BlockTemplate>(
      data: template,
      dragAnchorStrategy: pointerDragAnchorStrategy,
      feedback: Material(
        color: Colors.transparent,
        child: _chipVisual(opacity: 0.85),
      ),
      childWhenDragging: _chipVisual(opacity: 0.3),
      child: _chipVisual(opacity: 1.0),
    );
  }

  Widget _chipVisual({required double opacity}) {
    return Opacity(
      opacity: opacity,
      child: Container(
        width: 72,
        margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        decoration: BoxDecoration(
          color: Color(template.color),
          borderRadius: BorderRadius.circular(8),
        ),
        alignment: Alignment.center,
        child: Text(
          template.name,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.white, fontSize: 12),
        ),
      ),
    );
  }
}

class _PreviewPainter extends CustomPainter {
  _PreviewPainter({required this.startMinute, required this.lengthMinutes, required this.valid});
  final int startMinute;
  final int lengthMinutes;
  final bool valid;

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = size.center(Offset.zero);
    final double midRadius = math.min(size.width, size.height) / 2 - 4 - 12;
    final double startAngle = minuteToCanvasAngle(startMinute);
    final double sweep = minuteToCanvasAngle(startMinute + lengthMinutes) - startAngle;
    final Paint paint = Paint()
      ..color = (valid ? Colors.greenAccent : Colors.red).withValues(alpha: 0.6)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 34;
    canvas.drawArc(Rect.fromCircle(center: center, radius: midRadius), startAngle, sweep, false, paint);
  }

  @override
  bool shouldRepaint(covariant _PreviewPainter oldDelegate) =>
      oldDelegate.startMinute != startMinute ||
      oldDelegate.lengthMinutes != lengthMinutes ||
      oldDelegate.valid != valid;
}

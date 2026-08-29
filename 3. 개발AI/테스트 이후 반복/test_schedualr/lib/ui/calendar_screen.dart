/// 월간 캘린더 메인 화면 — FR-01.
library;

import 'package:flutter/material.dart';

import '../data/plan_repository.dart';
import '../domain/domain.dart';
import '../services/app_services.dart';
import '../services/permission_service.dart';
import 'day_editor_screen.dart';

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> with WidgetsBindingObserver {
  late DateTime _visibleMonth;
  final PlanDate _today = PlanDate.today();
  Map<String, AchievementCounts> _achievements = <String, AchievementCounts>{};
  PermissionStatusSnapshot? _permissionStatus;
  bool _loading = true;

  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _visibleMonth = DateTime(_today.year, _today.month);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_initialized) {
      _initialized = true;
      _load();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // T2: 앱이 포그라운드로 진입할 때(콜드 스타트 및 백그라운드 복귀 포함).
    if (state == AppLifecycleState.resumed) {
      _refreshSchedule();
      _load();
    }
  }

  Future<void> _refreshSchedule() async {
    final services = AppServices.of(context);
    await services.refreshNotificationSchedule();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final services = AppServices.of(context);
    final achievements = await services.repository.getMonthAchievements(
      _visibleMonth.year,
      _visibleMonth.month,
    );
    final permission = await services.permissions.currentStatus();
    if (!mounted) return;
    setState(() {
      _achievements = achievements;
      _permissionStatus = permission;
      _loading = false;
    });
  }

  void _changeMonth(int delta) {
    setState(() => _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month + delta));
    _load();
  }

  Future<void> _openDate(PlanDate date) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => DayEditorScreen(date: date)),
    );
    await _refreshSchedule();
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${_visibleMonth.year}년 ${_visibleMonth.month}월'),
        leading: IconButton(
          icon: const Icon(Icons.chevron_left),
          onPressed: () => _changeMonth(-1),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: () => _changeMonth(1),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_permissionStatus != null && _permissionStatus!.hasWarning)
            _PermissionBanner(status: _permissionStatus!),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _MonthGrid(
                    visibleMonth: _visibleMonth,
                    today: _today,
                    achievements: _achievements,
                    onSelectDate: _openDate,
                  ),
          ),
        ],
      ),
    );
  }
}

class _PermissionBanner extends StatelessWidget {
  const _PermissionBanner({required this.status});
  final PermissionStatusSnapshot status;

  @override
  Widget build(BuildContext context) {
    final String message = !status.notificationGranted
        ? '알림 권한이 없어 계획 알림이 발송되지 않습니다.'
        : '정확 알람 권한이 없어 알림이 예정 시각보다 늦게 도착할 수 있습니다.';
    return MaterialBanner(
      backgroundColor: Colors.amber.shade100,
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => AppServices.of(context).permissions.openAppSettingsScreen(),
          child: const Text('설정으로 이동'),
        ),
      ],
    );
  }
}

class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    required this.visibleMonth,
    required this.today,
    required this.achievements,
    required this.onSelectDate,
  });

  final DateTime visibleMonth;
  final PlanDate today;
  final Map<String, AchievementCounts> achievements;
  final ValueChanged<PlanDate> onSelectDate;

  @override
  Widget build(BuildContext context) {
    final DateTime firstOfMonth = DateTime(visibleMonth.year, visibleMonth.month, 1);
    final int daysInMonth = DateTime(visibleMonth.year, visibleMonth.month + 1, 0).day;
    // 월요일 시작 그리드. firstOfMonth.weekday: 1=월 ... 7=일.
    final int leadingBlanks = firstOfMonth.weekday - 1;

    final List<Widget> cells = <Widget>[
      for (int i = 0; i < leadingBlanks; i++) const SizedBox.shrink(),
      for (int day = 1; day <= daysInMonth; day++)
        _DayCell(
          date: PlanDate(visibleMonth.year, visibleMonth.month, day),
          isToday: PlanDate(visibleMonth.year, visibleMonth.month, day) == today,
          counts: achievements[PlanDate(visibleMonth.year, visibleMonth.month, day).key],
          onTap: onSelectDate,
        ),
    ];

    return GridView.count(
      crossAxisCount: 7,
      children: cells,
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.date,
    required this.isToday,
    required this.counts,
    required this.onTap,
  });

  final PlanDate date;
  final bool isToday;
  final AchievementCounts? counts;
  final ValueChanged<PlanDate> onTap;

  @override
  Widget build(BuildContext context) {
    final double? rate = counts == null || counts!.total == 0
        ? null
        : computeAchievementRate(counts!.completed, counts!.total);
    final double? opacity = rate == null ? null : dotOpacityFor(rate);

    return InkWell(
      onTap: () => onTap(date),
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (isToday)
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary,
                shape: BoxShape.circle,
              ),
            ),
          Text(
            '${date.day}',
            style: TextStyle(
              color: isToday ? Colors.white : null,
              fontWeight: isToday ? FontWeight.bold : FontWeight.normal,
            ),
          ),
          if (opacity != null)
            Positioned(
              bottom: 4,
              child: Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.secondary.withValues(alpha: opacity),
                  shape: BoxShape.circle,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

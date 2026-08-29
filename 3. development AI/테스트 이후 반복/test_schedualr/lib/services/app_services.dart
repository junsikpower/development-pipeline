/// 앱 전역 서비스 번들 — 데이터/알림/권한 계층을 UI 트리에 주입한다.
library;

import 'package:flutter/widgets.dart';

import '../data/app_database.dart';
import '../data/plan_repository.dart';
import '../domain/domain.dart';
import 'notification_service.dart';
import 'permission_service.dart';

class AppServices extends InheritedWidget {
  const AppServices({
    super.key,
    required this.repository,
    required this.notifications,
    required this.permissions,
    required this.appDatabase,
    required super.child,
  });

  final AppDatabase appDatabase;
  final PlanRepository repository;
  final NotificationService notifications;
  final PermissionService permissions;

  static AppServices of(BuildContext context) {
    final AppServices? result =
        context.dependOnInheritedWidgetOfExactType<AppServices>();
    assert(result != null, 'AppServices가 트리에 없습니다.');
    return result!;
  }

  @override
  bool updateShouldNotify(AppServices oldWidget) => false;

  /// 갱신 트리거(T1~T4) 공통 처리: 권한 상태를 확인하고, 알림 권한이 있을
  /// 때에만 예약 큐를 재계산해 OS에 반영한다(FR-11, EC-01).
  Future<void> refreshNotificationSchedule() async {
    final status = await permissions.currentStatus();
    if (!status.notificationGranted) return;

    final blocks = await repository.getAllLogicalBlocks();
    final candidates = collectCandidates(blocks, DateTime.now());
    final queue = buildScheduleQueue(candidates);
    await notifications.applySchedule(queue, exactAlarmAllowed: status.exactAlarmGranted);
  }
}

import 'package:flutter/material.dart';

import 'data/app_database.dart';
import 'data/plan_repository.dart';
import 'domain/domain.dart';
import 'services/app_services.dart';
import 'services/notification_service.dart';
import 'services/permission_service.dart';
import 'ui/calendar_screen.dart';

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final AppDatabase db = await AppDatabase.open();
  final PlanRepository repository = PlanRepository(db);
  final NotificationService notifications = NotificationService();
  final PermissionService permissions = PermissionService();

  await notifications.init();

  runApp(
    CircularSchedulerApp(
      appDatabase: db,
      repository: repository,
      notifications: notifications,
      permissions: permissions,
    ),
  );

  // 최초 실행 시 알림 권한을 요청한다(9.4). 거부 시에도 나머지 기능은
  // 정상 동작하며 EC-01의 배너로 안내한다.
  await permissions.requestNotificationPermission();

  // T2: 콜드 스타트도 포그라운드 진입에 포함된다(FR-11).
  final status = await permissions.currentStatus();
  if (status.notificationGranted) {
    final blocks = await repository.getAllLogicalBlocks();
    final candidates = collectCandidates(blocks, DateTime.now());
    final queue = buildScheduleQueue(candidates);
    await notifications.applySchedule(queue, exactAlarmAllowed: status.exactAlarmGranted);
  }

  // T3: 알림 탭으로 앱에 진입할 때.
  notifications.onTap = (target) {
    final NavigatorState? nav = navigatorKey.currentState;
    if (nav == null) return;
    if (target is OpenDateEditor) {
      // 알림에는 대표 인스턴스 id만 실려 있으므로, 오늘 날짜를 기본으로
      // 캘린더로 이동시켜 사용자가 직접 날짜를 확인하게 한다. 정확한 날짜
      // 역참조가 필요하면 리포지토리에서 인스턴스를 조회해 라우팅할 수 있다.
      nav.popUntil((route) => route.isFirst);
    } else if (target is OpenCalendar) {
      nav.popUntil((route) => route.isFirst);
    }
  };
}

class CircularSchedulerApp extends StatelessWidget {
  const CircularSchedulerApp({
    super.key,
    required this.appDatabase,
    required this.repository,
    required this.notifications,
    required this.permissions,
  });

  final AppDatabase appDatabase;
  final PlanRepository repository;
  final NotificationService notifications;
  final PermissionService permissions;

  @override
  Widget build(BuildContext context) {
    return AppServices(
      appDatabase: appDatabase,
      repository: repository,
      notifications: notifications,
      permissions: permissions,
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: '원형 하루 스케줄러',
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple)),
        home: const CalendarScreen(),
      ),
    );
  }
}

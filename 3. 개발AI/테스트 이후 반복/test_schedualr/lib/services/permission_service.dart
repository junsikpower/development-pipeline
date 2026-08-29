/// 알림/정확 알람 권한 관리 — 9.4, BR-11, EC-01, EC-02.
///
/// 요청하는 OS 권한은 알림 권한과 (Android 12+) 정확 알람 권한으로 한정한다.
/// 그 외 권한(위치·연락처·저장소·배터리 최적화 예외 등)은 요청하지 않는다.
library;

import 'package:permission_handler/permission_handler.dart';

/// 권한 차원 상태 (6.1: `PermissionOK` / `PermissionWarning`).
class PermissionStatusSnapshot {
  const PermissionStatusSnapshot({
    required this.notificationGranted,
    required this.exactAlarmGranted,
  });

  final bool notificationGranted;

  /// Android 12 미만이거나 iOS인 경우 이 권한 자체가 무의미하므로 항상 true로
  /// 취급한다(9.4: "정확 알람 권한의 위상 — 알림 기능의 전제 조건이 아니다").
  final bool exactAlarmGranted;

  /// 배너를 표시해야 하는 상태인지 여부(BR-11).
  bool get hasWarning => !notificationGranted || !exactAlarmGranted;
}

class PermissionService {
  Future<PermissionStatusSnapshot> currentStatus() async {
    final notificationStatus = await Permission.notification.status;
    final exactAlarmStatus = await Permission.scheduleExactAlarm.status;

    // scheduleExactAlarm은 Android 12 미만/iOS에서 permanentlyDenied가 아닌
    // restricted/limited 등 플랫폼 무관 값을 반환할 수 있으므로, granted가
    // 아니어도 플랫폼이 애초에 이 권한 개념을 갖지 않으면 경고로 취급하지 않는다.
    // permission_handler는 미지원 플랫폼에서 기본적으로 granted를 반환한다.
    return PermissionStatusSnapshot(
      notificationGranted: notificationStatus.isGranted,
      exactAlarmGranted: exactAlarmStatus.isGranted,
    );
  }

  /// 알림 권한을 요청한다. Android 13(API 33) 미만에서는 런타임 요청 없이
  /// 부여된 것으로 취급된다(9.4) — permission_handler가 이를 granted로 반환한다.
  Future<bool> requestNotificationPermission() async {
    final status = await Permission.notification.request();
    return status.isGranted;
  }

  /// 정확 알람 권한 요청 경로. 미부여 시에도 기능은 부정확 알람으로 계속
  /// 제공되므로(EC-02, TD-18) 결과값은 UI 안내에만 사용한다.
  Future<bool> requestExactAlarmPermission() async {
    final status = await Permission.scheduleExactAlarm.request();
    return status.isGranted;
  }

  /// 배터리 최적화 예외 요청 다이얼로그는 제공하지 않는다(OS-11).
  /// OS 설정 화면으로 이동하는 경로만 제공한다(BR-11).
  Future<void> openAppSettingsScreen() => openAppSettings();
}

/// OS 로컬 알림 스케줄러 연동 — FR-11, FR-12, 11.3, EC-02.
///
/// 유일한 외부 의존인 OS 알림 스케줄러를 감싼다(11.1). 갱신 트리거(T1~T4)
/// 발생 시 기존 예약을 전량 취소하고 [ScheduleQueue] 결과로 재예약한다
/// (FR-11 (5)).
library;

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../domain/domain.dart';

/// 알림 탭 시 어디로 진입해야 하는지를 나타낸다(FR-12 (4)).
sealed class NotificationTapTarget {
  const NotificationTapTarget();
}

class OpenDateEditor extends NotificationTapTarget {
  const OpenDateEditor(this.instanceId);
  final String instanceId;
}

class OpenCalendar extends NotificationTapTarget {
  const OpenCalendar();
}

/// 계획 알림·예약 갱신 리마인더용 단일 채널(11.3: "채널 1개를 정의한다").
const String _channelId = 'plan_notifications';
const String _channelName = '계획 알림';
const String _channelDescription = '블럭 시작·사전 알림 및 예약 갱신 리마인더';

class NotificationService {
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  void Function(NotificationTapTarget target)? onTap;

  Future<void> init() async {
    tzdata.initializeTimeZones();
    try {
      final String tzName = await FlutterTimezone.getLocalTimezone();
      tz.setLocalLocation(tz.getLocation(tzName));
    } catch (_) {
      // 타임존 조회 실패 시 UTC로 폴백한다. 네트워크에 의존하지 않는 로컬
      // 조회이므로(BR-13) 실패는 기기 설정 이상 상황에 한정된다.
    }

    const AndroidInitializationSettings androidInit =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const DarwinInitializationSettings iosInit = DarwinInitializationSettings();
    const InitializationSettings settings =
        InitializationSettings(android: androidInit, iOS: iosInit);

    await _plugin.initialize(
      settings,
      onDidReceiveNotificationResponse: _handleTap,
    );

    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      _channelId,
      _channelName,
      description: _channelDescription,
      importance: Importance.high,
    );
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);
  }

  void _handleTap(NotificationResponse response) {
    final String? payload = response.payload;
    if (onTap == null || payload == null) return;
    if (payload == 'horizon') {
      onTap!(const OpenCalendar());
    } else {
      onTap!(OpenDateEditor(payload));
    }
  }

  /// 예약 큐를 OS에 반영한다. 항상 전량 취소 후 재등록한다(FR-11 (5)).
  /// [exactAlarmAllowed]가 false이면 부정확 알람으로 예약한다(EC-02, TD-18).
  Future<void> applySchedule(
    ScheduleQueue queue, {
    required bool exactAlarmAllowed,
  }) async {
    await _plugin.cancelAll();

    final AndroidScheduleMode mode = exactAlarmAllowed
        ? AndroidScheduleMode.exactAllowWhileIdle
        : AndroidScheduleMode.inexactAllowWhileIdle;

    const NotificationDetails details = NotificationDetails(
      android: AndroidNotificationDetails(
        _channelId,
        _channelName,
        channelDescription: _channelDescription,
        importance: Importance.high,
        priority: Priority.high,
      ),
      iOS: DarwinNotificationDetails(),
    );

    for (final NotificationScheduleItem item in queue.scheduled) {
      final tz.TZDateTime fireAt = tz.TZDateTime.from(item.fireAt, tz.local);
      final String payload =
          item.type == NotificationType.horizonReminder ? 'horizon' : (item.instanceId ?? '');

      await _plugin.zonedSchedule(
        item.id,
        item.title,
        item.body,
        fireAt,
        details,
        androidScheduleMode: mode,
        uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
        payload: payload,
      );
    }
  }
}

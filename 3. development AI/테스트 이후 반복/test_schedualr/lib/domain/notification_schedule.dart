/// 알림 롤링 예약 및 예약 지평 관리 — FR-11, FR-12, BR-06, TD-09, TD-16.
///
/// 앱은 임의 시점에 자동 실행되지 않으므로(PP-02) 예약 큐 갱신은 앱이
/// 실제 실행되는 순간(T1~T4)에만 수행된다. 이 모듈은 그 순간에 호출되는
/// 순수 계산 로직만 담당하며, 실제 OS 등록은 별도 서비스 계층이 수행한다.
library;

import 'models.dart';
import 'plan_date.dart';
import 'time_grid.dart';

/// 앱 명칭. 예약 갱신 리마인더 알림의 제목으로 사용한다(FR-12 (2)).
const String appDisplayName = '원형 하루 스케줄러';

/// OS 등록 대기 알림의 앱 자체 보수적 상한 (BR-06, TD-09).
const int maxScheduledNotifications = 50;

/// 계획 알림(시작+사전)의 최대 개수. 나머지 1슬롯은 예약 갱신 리마인더용이다.
const int maxPlanNotifications = maxScheduledNotifications - 1;

/// 예약 이전 단계의 알림 후보. 아직 OS에 등록되지 않은 순수 계산 결과이다.
class NotificationCandidate implements Comparable<NotificationCandidate> {
  const NotificationCandidate({
    required this.block,
    required this.fireAt,
    required this.type,
  });

  /// 대표 인스턴스에 대응하는 논리 블럭. horizonReminder에는 사용하지 않는다.
  final LogicalBlock block;
  final DateTime fireAt;
  final NotificationType type;

  @override
  int compareTo(NotificationCandidate other) => fireAt.compareTo(other.fireAt);
}

/// 논리 블럭 목록으로부터 미래 알림 후보를 생성한다(시작 1개 + 사전 0~1개).
///
/// 과거 시각의 후보는 제외한다("이미 지난 시각의 후보는 예약하지 않는다",
/// FR-11 (2)). [now] 이후(포함하지 않음, 즉 엄격히 미래)만 후보로 남긴다.
/// 링크 그룹당 시작 알림은 대표 인스턴스 기준 1회만 발생한다(FR-09 (5)).
List<NotificationCandidate> collectCandidates(
  Iterable<LogicalBlock> logicalBlocks,
  DateTime now,
) {
  final List<NotificationCandidate> candidates = <NotificationCandidate>[];

  for (final LogicalBlock block in logicalBlocks) {
    final DateTime startFireAt = block.startMoment.toDateTime();
    if (startFireAt.isAfter(now)) {
      candidates.add(
        NotificationCandidate(
          block: block,
          fireAt: startFireAt,
          type: NotificationType.start,
        ),
      );
    }

    final int? pre = block.preNotifyMinutes;
    if (pre != null) {
      final DateTime preFireAt = startFireAt.subtract(Duration(minutes: pre));
      if (preFireAt.isAfter(now)) {
        candidates.add(
          NotificationCandidate(
            block: block,
            fireAt: preFireAt,
            type: NotificationType.pre,
          ),
        );
      }
    }
  }

  candidates.sort();
  return candidates;
}

/// 예약 큐 갱신 결과. [scheduled]는 OS에 등록할 항목, [unscheduledCount]는
/// 예약 지평 밖에 남아 `Unscheduled` 상태로 보존되는 후보 수이다(BR-06).
class ScheduleQueue {
  const ScheduleQueue({required this.scheduled, required this.unscheduledCount});

  final List<NotificationScheduleItem> scheduled;
  final int unscheduledCount;

  /// 예약 지평: 마지막 갱신 시점에 예약된 항목 중 가장 늦은 발송 시각.
  DateTime? get horizon =>
      scheduled.isEmpty ? null : scheduled.last.fireAt;
}

/// 시각 오름차순 [candidates]로부터 예약 큐를 산출한다(FR-11 (1)~(4)).
///
/// - 후보가 49개 이하이면 리마인더 없이 전부 예약한다.
/// - 49개를 초과하면 앞에서부터 49개만 예약하고, 마지막 슬롯에 예약 갱신
///   리마인더를 추가한다. 리마인더 발송 시각은 49번째(예약 지평의 마지막)
///   계획 알림 발송 시각과 같다.
ScheduleQueue buildScheduleQueue(List<NotificationCandidate> candidates) {
  assert(
    _isSortedAscending(candidates),
    '후보는 시각 오름차순으로 정렬되어 있어야 합니다.',
  );

  if (candidates.length <= maxPlanNotifications) {
    final List<NotificationScheduleItem> items = <NotificationScheduleItem>[
      for (final NotificationCandidate c in candidates) _toScheduleItem(c),
    ];
    return ScheduleQueue(scheduled: items, unscheduledCount: 0);
  }

  final List<NotificationCandidate> taken =
      candidates.sublist(0, maxPlanNotifications);
  final int unscheduledCount = candidates.length - maxPlanNotifications;

  final DateTime horizonFireAt = taken.last.fireAt;
  final List<NotificationScheduleItem> items = <NotificationScheduleItem>[
    for (final NotificationCandidate c in taken) _toScheduleItem(c),
    NotificationScheduleItem(
      id: notificationIdFor('horizon-reminder-$horizonFireAt'),
      fireAt: horizonFireAt,
      type: NotificationType.horizonReminder,
      title: appDisplayName,
      body: '이후 일정 알림을 계속 받으려면 앱을 열어주세요.',
    ),
  ];

  return ScheduleQueue(scheduled: items, unscheduledCount: unscheduledCount);
}

bool _isSortedAscending(List<NotificationCandidate> list) {
  for (int i = 1; i < list.length; i++) {
    if (list[i].fireAt.isBefore(list[i - 1].fireAt)) return false;
  }
  return true;
}

NotificationScheduleItem _toScheduleItem(NotificationCandidate c) {
  final String representativeId = c.block.instanceIds.isNotEmpty
      ? c.block.instanceIds.first
      : c.block.linkId;

  final String idKey = '${representativeId}_${c.type.name}';

  return NotificationScheduleItem(
    id: notificationIdFor(idKey),
    instanceId: representativeId,
    fireAt: c.fireAt,
    type: c.type,
    title: c.block.nameSnapshot,
    body: _bodyFor(c),
  );
}

/// 알림 본문 (FR-12 (2)). 사전 알림과 시작 알림은 서로 다른 문구를 갖는다.
String _bodyFor(NotificationCandidate c) {
  switch (c.type) {
    case NotificationType.start:
      final String startLabel = formatMinuteOfDay(c.block.startMinute);
      final PlanMoment end = c.block.endMoment;
      final String endLabel = end.date == c.block.date
          ? formatMinuteOfDay(end.minuteOfDay)
          : '익일 ${formatMinuteOfDay(end.minuteOfDay)}';
      return '$startLabel부터 $endLabel까지입니다.';
    case NotificationType.pre:
      final int minutesLeft = c.block.startMoment
          .toDateTime()
          .difference(c.fireAt)
          .inMinutes;
      return '$minutesLeft분 후 시작합니다.';
    case NotificationType.horizonReminder:
      return '이후 일정 알림을 계속 받으려면 앱을 열어주세요.';
  }
}

/// [key]로부터 결정적 정수 알림 id를 생성한다(FNV-1a 32bit).
/// 동일한 key는 항상 동일한 id를 산출하므로, 갱신 시 기존 예약 취소·재등록이
/// 안전하게 대응된다.
int notificationIdFor(String key) {
  int hash = 0x811c9dc5;
  for (final int codeUnit in key.codeUnits) {
    hash ^= codeUnit;
    hash = (hash * 0x01000193) & 0xFFFFFFFF;
  }
  return hash & 0x7FFFFFFF;
}

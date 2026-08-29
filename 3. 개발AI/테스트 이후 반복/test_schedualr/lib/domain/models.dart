/// 핵심 데이터 엔티티 (PRD 6.3).
///
/// 템플릿과 인스턴스를 분리하고, 인스턴스는 생성 시점 템플릿 속성의
/// 스냅샷을 보유한다(BR-03, TD-07). 템플릿이 수정·삭제되어도 과거 기록이
/// 오염되지 않으며 고아 인스턴스라는 상태가 존재하지 않는다.
library;

import 'plan_date.dart';
import 'time_grid.dart';

/// 사전 알림 옵션 (FR-12 (1)). null / 5 / 10 만 허용한다.
const List<int> allowedPreNotifyMinutes = <int>[5, 10];

/// 블럭 템플릿. 배치의 원본이며 인스턴스와 참조 무결성 제약을 갖지 않는다.
class BlockTemplate {
  const BlockTemplate({
    required this.id,
    required this.name,
    required this.color,
    required this.icon,
    required this.defaultDurationMinutes,
    required this.isSeed,
  });

  final String id;
  final String name;

  /// ARGB 정수값. 구체적 팔레트는 구현 자유 영역이다(12.3 (1)).
  final int color;

  /// 아이콘 식별자. 색상과 항상 함께 보유한다(FR-04, NFR-06).
  final String icon;

  /// 배치 시 적용될 기본 길이. 10~1440, 10분 배수.
  final int defaultDurationMinutes;

  /// 기본 제공 8종 여부 (TD-08).
  final bool isSeed;

  BlockTemplate copyWith({
    String? id,
    String? name,
    int? color,
    String? icon,
    int? defaultDurationMinutes,
    bool? isSeed,
  }) {
    return BlockTemplate(
      id: id ?? this.id,
      name: name ?? this.name,
      color: color ?? this.color,
      icon: icon ?? this.icon,
      defaultDurationMinutes:
          defaultDurationMinutes ?? this.defaultDurationMinutes,
      isSeed: isSeed ?? this.isSeed,
    );
  }

  /// 템플릿 자체의 값 정합성. 저장 전 검증에 사용한다.
  bool get isValid =>
      name.trim().isNotEmpty &&
      isOnGrid(defaultDurationMinutes) &&
      defaultDurationMinutes >= minDurationMinutes &&
      defaultDurationMinutes <= maxDurationMinutes;
}

/// 블럭 인스턴스. 논리 블럭이 특정 날짜에 점유하는 구간을 나타내는 DB 레코드.
///
/// 모든 인스턴스는 `startMinute + durationMinutes <= 1440`을 만족한다.
/// 이 불변식 덕분에 날짜별 구간 비교만으로 전체 겹침 검증이 완전해진다(NFR-04).
class BlockInstance {
  const BlockInstance({
    required this.id,
    required this.date,
    required this.startMinute,
    required this.durationMinutes,
    required this.nameSnapshot,
    required this.colorSnapshot,
    required this.iconSnapshot,
    this.linkId,
    this.isLinkStart = true,
    this.preNotifyMinutes,
    this.isCompleted = false,
  });

  /// 인스턴스 식별자. 아직 저장되지 않은 Draft는 세션 내 임시 id를 갖는다.
  final String id;

  final PlanDate date;

  /// 해당 날짜 내 시작 분. 0~1430, 10분 배수.
  final int startMinute;

  /// 해당 날짜 내 점유 길이. 10~1440, 10분 배수.
  final int durationMinutes;

  /// 생성 시점 템플릿 속성의 복제본 (BR-03).
  final String nameSnapshot;
  final int colorSnapshot;
  final String iconSnapshot;

  /// 자정 교차 링크 그룹 식별자. 미교차 시 null (BR-04).
  final String? linkId;

  /// 대표 인스턴스 여부. 링크 그룹당 정확히 1개가 true.
  /// 링크되지 않은 단일 인스턴스는 그 자체가 대표이므로 true이다.
  final bool isLinkStart;

  /// 사전 알림. null / 5 / 10. 대표 인스턴스에만 유효하다.
  final int? preNotifyMinutes;

  /// 완료 여부. 대표 인스턴스에만 유효하다.
  final bool isCompleted;

  /// 해당 날짜 내 종료 분. 1440 이하가 보장된다.
  int get endMinute => startMinute + durationMinutes;

  /// 자정 교차 논리 블럭의 일부인지 여부.
  bool get isLinked => linkId != null;

  /// 이 인스턴스가 논리 블럭 단위 속성(알림·완료)의 보유자인지 여부.
  bool get isRepresentative => isLinkStart;

  BlockInstance copyWith({
    String? id,
    PlanDate? date,
    int? startMinute,
    int? durationMinutes,
    String? nameSnapshot,
    int? colorSnapshot,
    String? iconSnapshot,
    String? linkId,
    bool clearLinkId = false,
    bool? isLinkStart,
    int? preNotifyMinutes,
    bool clearPreNotify = false,
    bool? isCompleted,
  }) {
    return BlockInstance(
      id: id ?? this.id,
      date: date ?? this.date,
      startMinute: startMinute ?? this.startMinute,
      durationMinutes: durationMinutes ?? this.durationMinutes,
      nameSnapshot: nameSnapshot ?? this.nameSnapshot,
      colorSnapshot: colorSnapshot ?? this.colorSnapshot,
      iconSnapshot: iconSnapshot ?? this.iconSnapshot,
      linkId: clearLinkId ? null : (linkId ?? this.linkId),
      isLinkStart: isLinkStart ?? this.isLinkStart,
      preNotifyMinutes:
          clearPreNotify ? null : (preNotifyMinutes ?? this.preNotifyMinutes),
      isCompleted: isCompleted ?? this.isCompleted,
    );
  }

  /// 인스턴스 단위 불변식 (BR-01, NFR-04).
  bool get isValid =>
      isOnGrid(startMinute) &&
      isOnGrid(durationMinutes) &&
      startMinute >= 0 &&
      startMinute <= maxStartMinute &&
      durationMinutes >= minDurationMinutes &&
      durationMinutes <= maxDurationMinutes &&
      endMinute <= minutesPerDay &&
      (preNotifyMinutes == null ||
          allowedPreNotifyMinutes.contains(preNotifyMinutes));

  @override
  String toString() =>
      'BlockInstance($id, ${date.key}, '
      '${formatMinuteOfDay(startMinute)}+${durationMinutes}m, '
      'link=$linkId, start=$isLinkStart)';
}

/// 논리 블럭. 사용자가 하나의 활동으로 인지하는 단위 (PRD 4. 용어 정의).
///
/// 편집·삭제·완료·알림은 모두 이 단위로 수행되며(BR-04), 저장 시점에
/// FR-09의 분할 규칙으로 인스턴스 1~2개로 환원된다.
class LogicalBlock {
  const LogicalBlock({
    required this.linkId,
    required this.date,
    required this.startMinute,
    required this.durationMinutes,
    required this.nameSnapshot,
    required this.colorSnapshot,
    required this.iconSnapshot,
    this.preNotifyMinutes,
    this.isCompleted = false,
    this.instanceIds = const <String>[],
    this.isPersisted = false,
  });

  /// 링크 그룹 식별자. 자정을 넘지 않는 블럭도 편집 세션 내 동일성 추적을
  /// 위해 값을 보유하며, 저장 시 단일 인스턴스면 인스턴스의 linkId는 null이 된다.
  final String linkId;

  /// 논리 블럭의 시작 날짜. 대표 인스턴스의 date와 같다.
  final PlanDate date;

  /// 시작 날짜 내 시작 분. 0~1430.
  final int startMinute;

  /// 총 길이. 10~1440. 자정을 넘어도 하나의 값으로 유지된다(TD-12).
  final int durationMinutes;

  final String nameSnapshot;
  final int colorSnapshot;
  final String iconSnapshot;

  final int? preNotifyMinutes;
  final bool isCompleted;

  /// 이 논리 블럭에서 파생된 기존 인스턴스 id 목록. 저장 시 갱신 대상 식별에 쓴다.
  final List<String> instanceIds;

  /// DB에 커밋된 적이 있는지 여부. Draft에는 완료 체크를 제공하지 않는다(FR-14 (1)).
  final bool isPersisted;

  /// 자정을 넘는가. 이 판정이 분할 여부를 결정한다(FR-05 (4)).
  bool get crossesMidnight => startMinute + durationMinutes > minutesPerDay;

  /// 논리 블럭의 시작 시점.
  PlanMoment get startMoment => PlanMoment(date, startMinute);

  /// 논리 블럭의 종료 시점. 자정을 넘으면 다음 날로 정규화된다.
  PlanMoment get endMoment =>
      PlanMoment.normalized(date, startMinute + durationMinutes);

  /// 이 논리 블럭이 점유하는 날짜 목록. 자정 교차 시 2개.
  List<PlanDate> get occupiedDates =>
      crossesMidnight ? <PlanDate>[date, date.nextDay] : <PlanDate>[date];

  LogicalBlock copyWith({
    String? linkId,
    PlanDate? date,
    int? startMinute,
    int? durationMinutes,
    String? nameSnapshot,
    int? colorSnapshot,
    String? iconSnapshot,
    int? preNotifyMinutes,
    bool clearPreNotify = false,
    bool? isCompleted,
    List<String>? instanceIds,
    bool? isPersisted,
  }) {
    return LogicalBlock(
      linkId: linkId ?? this.linkId,
      date: date ?? this.date,
      startMinute: startMinute ?? this.startMinute,
      durationMinutes: durationMinutes ?? this.durationMinutes,
      nameSnapshot: nameSnapshot ?? this.nameSnapshot,
      colorSnapshot: colorSnapshot ?? this.colorSnapshot,
      iconSnapshot: iconSnapshot ?? this.iconSnapshot,
      preNotifyMinutes:
          clearPreNotify ? null : (preNotifyMinutes ?? this.preNotifyMinutes),
      isCompleted: isCompleted ?? this.isCompleted,
      instanceIds: instanceIds ?? this.instanceIds,
      isPersisted: isPersisted ?? this.isPersisted,
    );
  }

  /// 논리 블럭 단위 불변식.
  bool get isValid =>
      isOnGrid(startMinute) &&
      isOnGrid(durationMinutes) &&
      startMinute >= 0 &&
      startMinute <= maxStartMinute &&
      durationMinutes >= minDurationMinutes &&
      durationMinutes <= maxDurationMinutes &&
      (preNotifyMinutes == null ||
          allowedPreNotifyMinutes.contains(preNotifyMinutes));

  @override
  String toString() =>
      'LogicalBlock($linkId, ${date.key}, '
      '${formatMinuteOfDay(startMinute)}+${durationMinutes}m, '
      'crossesMidnight=$crossesMidnight)';
}

/// 알림 예약 항목의 종류 (PRD 6.3).
enum NotificationType {
  /// 논리 블럭 시작 시각 알림.
  start,

  /// 사전 알림 (5분 전 / 10분 전).
  pre,

  /// 예약 갱신 리마인더. instanceId를 갖지 않는다 (FR-11 (4)).
  horizonReminder,
}

/// 알림 예약 항목. DB에 영속화하지 않고 갱신 시마다 계산한다(7.2).
class NotificationScheduleItem {
  const NotificationScheduleItem({
    required this.id,
    required this.fireAt,
    required this.type,
    this.instanceId,
    this.title = '',
    this.body = '',
  });

  /// OS 예약 식별자. 취소·재예약의 기준이 된다.
  final int id;

  /// 대표 인스턴스의 id. horizonReminder는 null이다.
  final String? instanceId;

  final DateTime fireAt;
  final NotificationType type;

  final String title;
  final String body;

  @override
  String toString() =>
      'NotificationScheduleItem($id, $type, $fireAt, instance=$instanceId)';
}

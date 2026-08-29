/// 계획이 귀속되는 '날짜'를 나타내는 값 객체.
///
/// 시각 성분을 갖지 않으므로 타임존·서머타임에 의해 날짜가 흔들리지 않는다.
/// 자정 교차 블럭은 D일과 D+1일에 걸쳐 저장되므로(FR-09) 날짜 연산의
/// 결정성이 데이터 정합성의 전제가 된다.
library;

import 'time_grid.dart';

class PlanDate implements Comparable<PlanDate> {
  const PlanDate(this.year, this.month, this.day);

  final int year;
  final int month;
  final int day;

  /// 시각 성분을 버리고 날짜만 취한다.
  factory PlanDate.fromDateTime(DateTime dt) =>
      PlanDate(dt.year, dt.month, dt.day);

  /// 단말의 현재 날짜.
  factory PlanDate.today() => PlanDate.fromDateTime(DateTime.now());

  /// `YYYY-MM-DD` 형식 문자열을 파싱한다. DB 저장 형식과 대응한다.
  factory PlanDate.parse(String value) {
    final parts = value.split('-');
    if (parts.length != 3) {
      throw FormatException('날짜 형식이 올바르지 않습니다: $value');
    }
    return PlanDate(
      int.parse(parts[0]),
      int.parse(parts[1]),
      int.parse(parts[2]),
    );
  }

  /// DB 저장 및 정렬에 사용하는 키. 사전순 정렬이 날짜순 정렬과 일치한다.
  String get key =>
      '${year.toString().padLeft(4, '0')}-'
      '${month.toString().padLeft(2, '0')}-'
      '${day.toString().padLeft(2, '0')}';

  DateTime toDateTime() => DateTime(year, month, day);

  /// 이 날짜의 [minuteOfDay] 시점을 단말 로컬 시각으로 환산한다.
  ///
  /// 알림 발송 시각 계산에 사용한다. 1440분(자정)도 허용하며 다음 날 00:00이 된다.
  DateTime atMinute(int minuteOfDay) =>
      DateTime(year, month, day).add(Duration(minutes: minuteOfDay));

  /// [days]일 뒤의 날짜. 음수면 이전 날짜. 월·연 경계와 윤년을 DateTime에 위임한다.
  PlanDate addDays(int days) =>
      PlanDate.fromDateTime(DateTime(year, month, day + days));

  PlanDate get nextDay => addDays(1);

  PlanDate get previousDay => addDays(-1);

  /// 두 날짜 사이의 일수 차이. `other`가 미래면 양수.
  int daysUntil(PlanDate other) =>
      other.toDateTime().difference(toDateTime()).inDays;

  @override
  int compareTo(PlanDate other) {
    if (year != other.year) return year.compareTo(other.year);
    if (month != other.month) return month.compareTo(other.month);
    return day.compareTo(other.day);
  }

  bool operator <(PlanDate other) => compareTo(other) < 0;

  bool operator >(PlanDate other) => compareTo(other) > 0;

  bool operator <=(PlanDate other) => compareTo(other) <= 0;

  bool operator >=(PlanDate other) => compareTo(other) >= 0;

  @override
  bool operator ==(Object other) =>
      other is PlanDate &&
      other.year == year &&
      other.month == month &&
      other.day == day;

  @override
  int get hashCode => Object.hash(year, month, day);

  @override
  String toString() => key;
}

/// 날짜와 그 날짜 내 분을 함께 갖는 절대 시점.
///
/// 알림 후보의 발송 시각을 비교·정렬할 때 사용한다.
class PlanMoment implements Comparable<PlanMoment> {
  const PlanMoment(this.date, this.minuteOfDay);

  final PlanDate date;

  /// 0 이상 1440 이하. 1440은 그 날의 자정(= 다음 날 00:00)을 뜻한다.
  final int minuteOfDay;

  /// 자정을 넘긴 분을 다음 날로 이월하여 정규화한다.
  factory PlanMoment.normalized(PlanDate date, int minuteOfDay) {
    final int dayShift = minuteOfDay >= 0
        ? minuteOfDay ~/ minutesPerDay
        : ((minuteOfDay + 1) ~/ minutesPerDay) - 1;
    return PlanMoment(date.addDays(dayShift), wrapMinuteOfDay(minuteOfDay));
  }

  DateTime toDateTime() => date.atMinute(minuteOfDay);

  @override
  int compareTo(PlanMoment other) {
    final int byDate = date.compareTo(other.date);
    if (byDate != 0) return byDate;
    return minuteOfDay.compareTo(other.minuteOfDay);
  }

  @override
  bool operator ==(Object other) =>
      other is PlanMoment &&
      other.date == date &&
      other.minuteOfDay == minuteOfDay;

  @override
  int get hashCode => Object.hash(date, minuteOfDay);

  @override
  String toString() => '${date.key} ${formatMinuteOfDay(minuteOfDay)}';
}

/// 시간 그리드 규칙 (BR-01).
///
/// 하루는 1440분이며, 저장되는 모든 시각·길이는 10분의 배수이다.
/// 각도 변환식: 각도 = (분 / 1440) * 360. 10분 = 2.5도.
library;

/// 하루의 총 분.
const int minutesPerDay = 1440;

/// 스냅 단위 (TD-03).
const int snapMinutes = 10;

/// 인스턴스 최소 길이.
const int minDurationMinutes = 10;

/// 인스턴스 최대 길이.
const int maxDurationMinutes = minutesPerDay;

/// `startMinute`의 최대값. 최소 길이 10분이 하루 안에 들어와야 한다.
const int maxStartMinute = minutesPerDay - minDurationMinutes;

/// 분을 10분 단위로 스냅한다. 반올림 기준이며 결과는 항상 10의 배수이다.
int snapToGrid(double minute) {
  return (minute / snapMinutes).round() * snapMinutes;
}

/// 분을 하루 범위(0 이상 1440 미만)로 순환시킨다.
///
/// 음수 입력도 양의 나머지로 정규화한다. 예: -10 -> 1430.
int wrapMinuteOfDay(int minute) {
  final int m = minute % minutesPerDay;
  return m < 0 ? m + minutesPerDay : m;
}

/// 분을 각도(도)로 변환한다. 0분이 0도이며 시계 방향으로 증가한다 (FR-03 (1)).
double minutesToDegrees(num minutes) => (minutes / minutesPerDay) * 360.0;

/// 각도(도)를 분으로 변환한다.
double degreesToMinutes(num degrees) => (degrees / 360.0) * minutesPerDay;

/// 값이 10분의 배수인지 검사한다.
bool isOnGrid(int minutes) => minutes % snapMinutes == 0;

/// 값을 [lower], [upper] 범위로 자른다.
int clampInt(int value, int lower, int upper) {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}

/// 분을 `HH:mm` 형식으로 표기한다. 1440분은 `24:00`으로 표기한다.
String formatMinuteOfDay(int minute) {
  final int h = minute ~/ 60;
  final int m = minute % 60;
  return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}';
}

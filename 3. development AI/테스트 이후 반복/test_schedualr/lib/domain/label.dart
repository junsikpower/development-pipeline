/// 협소 블럭 표기 축약 규칙 — BR-08.
///
/// 판단 기준은 고정 분(minute) 임계값이 아니라 실제 렌더링될 호 중심선
/// 길이이므로, 화면 크기·글꼴 크기·해상도가 달라도 결과가 결정적이다.
library;

/// 축약 표기 단계.
enum LabelMode {
  /// 명칭 + 아이콘.
  nameAndIcon,

  /// 아이콘만.
  iconOnly,

  /// 색상만 (명칭·아이콘 모두 미표시).
  colorOnly,
}

/// 호 중심선 길이 [arcLength]와 텍스트/아이콘 렌더링에 필요한 폭들로부터
/// 표기 단계를 결정한다(BR-08 적용 순서).
///
/// - `arcLength >= nameWidth + iconWidth + padding` -> [LabelMode.nameAndIcon]
/// - `arcLength >= iconWidth + padding`             -> [LabelMode.iconOnly]
/// - 그 외                                           -> [LabelMode.colorOnly]
LabelMode decideLabelMode({
  required double arcLength,
  required double nameWidth,
  required double iconWidth,
  required double padding,
}) {
  if (arcLength >= nameWidth + iconWidth + padding) {
    return LabelMode.nameAndIcon;
  }
  if (arcLength >= iconWidth + padding) {
    return LabelMode.iconOnly;
  }
  return LabelMode.colorOnly;
}

/// 호 중심선 길이 `L = r_mid * theta` (theta는 라디안).
double arcMidLength(double midRadius, double angleRadians) =>
    midRadius * angleRadians;

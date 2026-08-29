/// 기본 블럭 8종 시드 데이터 — FR-04, TD-08.
library;

import '../domain/domain.dart';
import 'id_generator.dart';

/// 최초 실행 시 생성할 기본 템플릿 8종.
/// 색상·아이콘의 구체적 값은 구현 자유 영역이다(12.3 (1)).
List<BlockTemplate> buildSeedTemplates(IdGenerator ids) => <BlockTemplate>[
      BlockTemplate(
        id: ids.next(),
        name: '잠자기',
        color: 0xFF5C6BC0,
        icon: 'bedtime',
        defaultDurationMinutes: 480,
        isSeed: true,
      ),
      BlockTemplate(
        id: ids.next(),
        name: '밥먹기',
        color: 0xFFFF7043,
        icon: 'restaurant',
        defaultDurationMinutes: 30,
        isSeed: true,
      ),
      BlockTemplate(
        id: ids.next(),
        name: '씻기',
        color: 0xFF29B6F6,
        icon: 'shower',
        defaultDurationMinutes: 20,
        isSeed: true,
      ),
      BlockTemplate(
        id: ids.next(),
        name: '공부하기',
        color: 0xFF66BB6A,
        icon: 'menu_book',
        defaultDurationMinutes: 60,
        isSeed: true,
      ),
      BlockTemplate(
        id: ids.next(),
        name: '운동하기',
        color: 0xFFEF5350,
        icon: 'fitness_center',
        defaultDurationMinutes: 60,
        isSeed: true,
      ),
      BlockTemplate(
        id: ids.next(),
        name: '이동',
        color: 0xFFFFCA28,
        icon: 'directions_walk',
        defaultDurationMinutes: 30,
        isSeed: true,
      ),
      BlockTemplate(
        id: ids.next(),
        name: '휴식',
        color: 0xFFAB47BC,
        icon: 'self_improvement',
        defaultDurationMinutes: 30,
        isSeed: true,
      ),
      BlockTemplate(
        id: ids.next(),
        name: '기타',
        color: 0xFF78909C,
        icon: 'more_horiz',
        defaultDurationMinutes: 30,
        isSeed: true,
      ),
    ];

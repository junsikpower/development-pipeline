/// 로컬 고유 식별자 생성기.
///
/// 서버가 없으므로 전역 유일성은 불필요하며, 단말 내에서 시간 기반 접두어와
/// 무작위 접미어로 실질적 충돌 가능성을 제거하는 것으로 충분하다.
library;

import 'dart:math';

class IdGenerator {
  IdGenerator({Random? random}) : _random = random ?? Random.secure();

  final Random _random;

  String next() {
    final int millis = DateTime.now().microsecondsSinceEpoch;
    final int suffix = _random.nextInt(0x7FFFFFFF);
    return '${millis.toRadixString(36)}_${suffix.toRadixString(36)}';
  }
}

/// 계획 데이터 저장소 — SQLite 단일 트랜잭션 처리 (BR-12, FR-08, FR-09, FR-10,
/// FR-13, FR-14).
///
/// 겹침 검증은 SQLite 스키마가 아닌 이 계층의 저장 직전 애플리케이션 검증으로
/// 수행한다(BR-12). 삭제는 물리 삭제이며 soft-delete를 남기지 않는다.
library;

import 'package:sqflite/sqflite.dart';

import '../domain/domain.dart';
import 'app_database.dart';
import 'id_generator.dart';
import 'mappers.dart';
import 'schema.dart';

/// 저장·삭제 도중 겹침이 발견되어 트랜잭션이 취소되었음을 알리는 예외
/// (FR-10 (2): 검증 실패 시 트랜잭션 미실행, 사용자에게 원인 표시).
class OverlapViolationException implements Exception {
  OverlapViolationException(this.conflicts);
  final List<OverlapConflict> conflicts;

  @override
  String toString() => 'OverlapViolationException(${conflicts.length}건 충돌)';
}

/// 날짜별 완료/전체 논리 블럭 수 (FR-14 (3)).
class AchievementCounts {
  const AchievementCounts(this.completed, this.total);
  final int completed;
  final int total;
}

class PlanRepository {
  PlanRepository(this._appDb, {IdGenerator? ids}) : _ids = ids ?? IdGenerator();

  final AppDatabase _appDb;
  final IdGenerator _ids;

  Database get _db => _appDb.raw;

  // ---------------------------------------------------------------------
  // 템플릿 (FR-04, BR-03)
  // ---------------------------------------------------------------------

  Future<List<BlockTemplate>> getAllTemplates() async {
    final rows = await _db.query(tableTemplates, orderBy: 'rowid ASC');
    return rows.map(templateFromRow).toList(growable: false);
  }

  /// 신규 생성 또는 기존 수정. 기존 인스턴스에는 소급 적용되지 않는다(BR-03).
  Future<void> upsertTemplate(BlockTemplate template) async {
    await _db.insert(
      tableTemplates,
      templateToRow(template),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// 라이브러리에서 즉시 제거한다. 기존 인스턴스는 스냅샷을 보유하므로
  /// 별도 정리가 필요 없다(FR-04, 7.5).
  Future<void> deleteTemplate(String templateId) async {
    await _db.delete(tableTemplates, where: 'id = ?', whereArgs: [templateId]);
  }

  String newTemplateId() => _ids.next();

  // ---------------------------------------------------------------------
  // 조회
  // ---------------------------------------------------------------------

  Future<List<BlockInstance>> getInstancesForDate(PlanDate date) async {
    final rows = await _db.query(
      tableInstances,
      where: 'date = ?',
      whereArgs: [date.key],
    );
    return rows.map(instanceFromRow).toList(growable: false);
  }

  Future<List<BlockInstance>> _getInstancesForDates(List<PlanDate> dates) async {
    if (dates.isEmpty) return const <BlockInstance>[];
    final placeholders = List.filled(dates.length, '?').join(',');
    final rows = await _db.query(
      tableInstances,
      where: 'date IN ($placeholders)',
      whereArgs: dates.map((d) => d.key).toList(),
    );
    return rows.map(instanceFromRow).toList(growable: false);
  }

  Future<List<BlockInstance>> getAllInstances() async {
    final rows = await _db.query(tableInstances);
    return rows.map(instanceFromRow).toList(growable: false);
  }

  /// [date]에 표시되는 모든 논리 블럭(대표가 오늘인 것 + 전날 이월분)을
  /// 복원한다(FR-02). 전날·다음날 데이터까지 함께 읽어 링크 그룹을
  /// 완전하게 복원한 뒤 [date]에 걸치는 것만 남긴다.
  Future<List<LogicalBlock>> getLogicalBlocksTouchingDate(PlanDate date) async {
    final all = await _getInstancesForDates(
      <PlanDate>[date.previousDay, date, date.nextDay],
    );
    final blocks = rebuildLogicalBlocks(all);
    return blocks.where((b) => b.occupiedDates.contains(date)).toList();
  }

  /// 전체 논리 블럭. 알림 큐 갱신(FR-11)에 사용한다.
  Future<List<LogicalBlock>> getAllLogicalBlocks() async {
    final all = await getAllInstances();
    return rebuildLogicalBlocks(all);
  }

  /// [date]의 달성률 산출을 위한 완료/전체 논리 블럭 수 — FR-14 (3), BR-05.
  Future<AchievementCounts> getAchievementCounts(PlanDate date) async {
    final blocks = await getLogicalBlocksTouchingDate(date);
    final total = blocks.length;
    final completed = blocks.where((b) => b.isCompleted).length;
    return AchievementCounts(completed, total);
  }

  /// [year]/[month]의 각 날짜별 달성 현황 — 캘린더 도트 렌더링(FR-01, BR-09)에
  /// 사용한다. 월 경계에 걸친 자정 교차 블럭을 정확히 반영하기 위해 전후
  /// 하루씩 더 넓게 조회한 뒤 재구성한다.
  Future<Map<String, AchievementCounts>> getMonthAchievements(int year, int month) async {
    final PlanDate first = PlanDate(year, month, 1).previousDay;
    final PlanDate last = PlanDate(year, month, 1).addDays(32);

    final List<PlanDate> range = <PlanDate>[];
    PlanDate cursor = first;
    while (cursor <= last) {
      range.add(cursor);
      cursor = cursor.nextDay;
    }

    final all = await _getInstancesForDates(range);
    final blocks = rebuildLogicalBlocks(all);

    final Map<String, List<LogicalBlock>> byDate = <String, List<LogicalBlock>>{};
    for (final block in blocks) {
      for (final date in block.occupiedDates) {
        if (date.year != year || date.month != month) continue;
        byDate.putIfAbsent(date.key, () => <LogicalBlock>[]).add(block);
      }
    }

    return byDate.map(
      (key, list) => MapEntry(
        key,
        AchievementCounts(list.where((b) => b.isCompleted).length, list.length),
      ),
    );
  }

  // ---------------------------------------------------------------------
  // 저장 (FR-08, FR-09, FR-10, BR-12)
  // ---------------------------------------------------------------------

  /// 편집 세션의 변경 사항을 단일 트랜잭션으로 커밋한다.
  ///
  /// [upserts]는 생성·수정된 논리 블럭(대표 날짜가 다를 수 있음 — 화면에
  /// 표시된 전날 이월분을 조작한 경우 포함), [deletedKeys]는 삭제된 논리
  /// 블럭의 linkId 또는 (링크가 없던 경우) 인스턴스 id이다.
  ///
  /// 겹침이 발견되면 [OverlapViolationException]을 던지고 트랜잭션은
  /// 커밋되지 않는다(FR-10 (2)).
  Future<void> saveLogicalBlocks({
    required List<LogicalBlock> upserts,
    List<String> deletedKeys = const <String>[],
  }) async {
    await _db.transaction((txn) async {
      final Set<String> touchedKeys = <String>{
        for (final b in upserts) b.linkId,
        ...deletedKeys,
      };

      final Set<String> touchedDateKeys = <String>{};
      for (final b in upserts) {
        for (final d in b.occupiedDates) {
          touchedDateKeys.add(d.key);
        }
      }

      // 기존 링크 그룹(수정 대상 및 삭제 대상)을 조회해 옛 날짜를 파악하고 삭제한다.
      for (final key in touchedKeys) {
        final oldRows = await txn.query(
          tableInstances,
          where: 'link_id = ? OR id = ?',
          whereArgs: [key, key],
        );
        for (final row in oldRows) {
          touchedDateKeys.add(row['date']! as String);
        }
        await txn.delete(
          tableInstances,
          where: 'link_id = ? OR id = ?',
          whereArgs: [key, key],
        );
      }

      // 신규 인스턴스 산출.
      final List<BlockInstance> candidateInstances = <BlockInstance>[
        for (final b in upserts) ...splitLogicalBlock(b, idFactory: _ids.next),
      ];

      // 영향받는 날짜의 잔존 기존 인스턴스(삭제 이후 상태)를 조회해 겹침을 검증한다.
      final remaining = <BlockInstance>[];
      for (final dateKey in touchedDateKeys) {
        final rows = await txn.query(
          tableInstances,
          where: 'date = ?',
          whereArgs: [dateKey],
        );
        remaining.addAll(rows.map(instanceFromRow));
      }

      final overlap = validateNoOverlap(candidateInstances, remaining);
      if (overlap.hasConflict) {
        throw OverlapViolationException(overlap.conflicts);
      }

      for (final instance in candidateInstances) {
        await txn.insert(tableInstances, instanceToRow(instance));
      }
    });
  }

  /// 링크 그룹 전체를 단일 트랜잭션으로 삭제한다(FR-09 (3), BR-04).
  Future<void> deleteLogicalBlock(String key) async {
    await _db.delete(
      tableInstances,
      where: 'link_id = ? OR id = ?',
      whereArgs: [key, key],
    );
  }

  /// 완료 체크 — 즉시 커밋, `Dirty` 판정과 무관하다(FR-14 (1), TD-15).
  /// 대표 인스턴스에만 저장된다(BR-04).
  Future<void> setCompletion(String representativeInstanceId, bool completed) async {
    await _db.update(
      tableInstances,
      <String, Object?>{'is_completed': completed ? 1 : 0},
      where: 'id = ? AND is_link_start = 1',
      whereArgs: [representativeInstanceId],
    );
  }

  // ---------------------------------------------------------------------
  // 날짜 복사 (FR-13, TD-17, EC-08, EC-09)
  // ---------------------------------------------------------------------

  Future<CopyDayResult> copyDay({
    required PlanDate source,
    required PlanDate target,
  }) async {
    final sourceInstances = await getInstancesForDate(source);
    final sourceLogical = rebuildLogicalBlocks(sourceInstances)
        .where((b) => b.date == source)
        .toList();

    final targetNextDayExisting = await getInstancesForDate(target.nextDay);

    final result = copyDayPlan(
      sourceDate: source,
      targetDate: target,
      sourceBlocks: sourceLogical,
      targetNextDayExisting: targetNextDayExisting,
      idFactory: _ids.next,
    );

    await _db.transaction((txn) async {
      // T일 인스턴스(전날 이월 구간 포함, 링크 그룹 전체)를 삭제한다(EC-08).
      final targetRows = await txn.query(
        tableInstances,
        where: 'date = ?',
        whereArgs: [target.key],
      );
      final Set<String> deleteKeys = <String>{};
      for (final row in targetRows) {
        final linkId = row['link_id'] as String?;
        deleteKeys.add(linkId ?? (row['id']! as String));
      }
      for (final key in deleteKeys) {
        await txn.delete(
          tableInstances,
          where: 'link_id = ? OR id = ?',
          whereArgs: [key, key],
        );
      }

      final List<BlockInstance> candidateInstances = <BlockInstance>[
        for (final b in result.createdBlocks)
          ...splitLogicalBlock(b, idFactory: _ids.next),
      ];
      for (final instance in candidateInstances) {
        await txn.insert(tableInstances, instanceToRow(instance));
      }
    });

    return result;
  }
}

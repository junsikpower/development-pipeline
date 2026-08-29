/// 로컬 SQLite 데이터베이스 초기화 — TD-10, 7.2.
library;

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'id_generator.dart';
import 'mappers.dart';
import 'schema.dart';
import 'seed_templates.dart';

class AppDatabase {
  AppDatabase._(this._db);

  final Database _db;
  Database get raw => _db;

  static Future<AppDatabase> open({String? overridePath}) async {
    final String path = overridePath ?? p.join(await getDatabasesPath(), 'circular_scheduler.db');
    final Database db = await openDatabase(
      path,
      version: schemaVersion,
      onCreate: (Database db, int version) async {
        await db.execute(createTemplatesTable);
        await db.execute(createInstancesTable);
        await db.execute(createDateIndex);
        await db.execute(createLinkIndex);
        await _seedInitialTemplates(db);
      },
    );
    return AppDatabase._(db);
  }

  static Future<void> _seedInitialTemplates(Database db) async {
    final IdGenerator ids = IdGenerator();
    final batch = db.batch();
    for (final t in buildSeedTemplates(ids)) {
      batch.insert(tableTemplates, templateToRow(t));
    }
    await batch.commit(noResult: true);
  }

  Future<void> close() => _db.close();
}

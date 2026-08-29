/// DB Row <-> 도메인 모델 매퍼.
library;

import '../domain/domain.dart';

Map<String, Object?> templateToRow(BlockTemplate t) => <String, Object?>{
      'id': t.id,
      'name': t.name,
      'color': t.color,
      'icon': t.icon,
      'default_duration_minutes': t.defaultDurationMinutes,
      'is_seed': t.isSeed ? 1 : 0,
    };

BlockTemplate templateFromRow(Map<String, Object?> row) => BlockTemplate(
      id: row['id']! as String,
      name: row['name']! as String,
      color: row['color']! as int,
      icon: row['icon']! as String,
      defaultDurationMinutes: row['default_duration_minutes']! as int,
      isSeed: (row['is_seed']! as int) != 0,
    );

Map<String, Object?> instanceToRow(BlockInstance i) => <String, Object?>{
      'id': i.id,
      'date': i.date.key,
      'start_minute': i.startMinute,
      'duration_minutes': i.durationMinutes,
      'name_snapshot': i.nameSnapshot,
      'color_snapshot': i.colorSnapshot,
      'icon_snapshot': i.iconSnapshot,
      'link_id': i.linkId,
      'is_link_start': i.isLinkStart ? 1 : 0,
      'pre_notify_minutes': i.preNotifyMinutes,
      'is_completed': i.isCompleted ? 1 : 0,
    };

BlockInstance instanceFromRow(Map<String, Object?> row) => BlockInstance(
      id: row['id']! as String,
      date: PlanDate.parse(row['date']! as String),
      startMinute: row['start_minute']! as int,
      durationMinutes: row['duration_minutes']! as int,
      nameSnapshot: row['name_snapshot']! as String,
      colorSnapshot: row['color_snapshot']! as int,
      iconSnapshot: row['icon_snapshot']! as String,
      linkId: row['link_id'] as String?,
      isLinkStart: (row['is_link_start']! as int) != 0,
      preNotifyMinutes: row['pre_notify_minutes'] as int?,
      isCompleted: (row['is_completed']! as int) != 0,
    );

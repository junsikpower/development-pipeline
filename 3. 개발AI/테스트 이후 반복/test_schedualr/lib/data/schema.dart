/// SQLite 물리 스키마 (BR-12, 7.2).
///
/// 겹침 금지(BR-02)는 SQLite 제약으로 표현할 수 없으므로 애플리케이션 계층의
/// 저장 직전 검증에 의존하며, 여기서는 물리 컬럼 정의만 담당한다.
library;

const int schemaVersion = 1;

const String tableTemplates = 'block_templates';
const String tableInstances = 'block_instances';

const String createTemplatesTable = '''
CREATE TABLE $tableTemplates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color INTEGER NOT NULL,
  icon TEXT NOT NULL,
  default_duration_minutes INTEGER NOT NULL,
  is_seed INTEGER NOT NULL
)
''';

// 참조 무결성 제약을 두지 않는다(BR-03): 템플릿이 삭제되어도 인스턴스는
// 스냅샷 컬럼만으로 정상 표시된다.
const String createInstancesTable = '''
CREATE TABLE $tableInstances (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  name_snapshot TEXT NOT NULL,
  color_snapshot INTEGER NOT NULL,
  icon_snapshot TEXT NOT NULL,
  link_id TEXT,
  is_link_start INTEGER NOT NULL,
  pre_notify_minutes INTEGER,
  is_completed INTEGER NOT NULL
)
''';

const String createDateIndex =
    'CREATE INDEX idx_instances_date ON $tableInstances(date)';

const String createLinkIndex =
    'CREATE INDEX idx_instances_link ON $tableInstances(link_id)';

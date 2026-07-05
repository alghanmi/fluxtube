// D1's `exec()` requires each statement on a single line — multi-line
// CREATE TABLE bodies error with "incomplete input". So the v1 schema is
// declared as an array of prepare().run() statements that mirror
// migrations/0002_v1_init.sql. Keep both in sync when you touch either.
//
// Each repo test file calls `resetV1Schema(db)` in beforeEach.

export const V1_TABLES = [
  'mapping_history',
  'mappings',
  'miniflux_instances',
  'config',
  'admin_passkey',
] as const;

export const V1_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS miniflux_instances (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name    TEXT    NOT NULL,
    url             TEXT    NOT NULL,
    api_token_ct    TEXT    NOT NULL,
    api_token_iv    TEXT    NOT NULL,
    api_token_kv    INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE(url)
  )`,
  `CREATE TABLE IF NOT EXISTS mappings (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    miniflux_instance_id   INTEGER NOT NULL
                                   REFERENCES miniflux_instances(id) ON DELETE CASCADE,
    miniflux_category      TEXT    NOT NULL,
    youtube_playlist_id    TEXT    NOT NULL,
    skip_shorts            INTEGER NOT NULL DEFAULT 0,
    created_at             INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL,
    UNIQUE(miniflux_instance_id, miniflux_category, youtube_playlist_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_mappings_instance ON mappings(miniflux_instance_id)',
  'CREATE INDEX IF NOT EXISTS idx_mappings_category ON mappings(miniflux_category)',
  `CREATE TABLE IF NOT EXISTS mapping_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_json  TEXT    NOT NULL,
    actor          TEXT    NOT NULL,
    created_at     INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_mapping_history_created ON mapping_history(created_at DESC)',
  `CREATE TABLE IF NOT EXISTS config (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    value_ct    TEXT,
    value_iv    TEXT,
    value_kv    INTEGER,
    updated_at  INTEGER NOT NULL,
    CHECK ((value IS NOT NULL) <> (value_ct IS NOT NULL)),
    CHECK ((value_ct IS NULL) = (value_iv IS NULL)),
    CHECK ((value_ct IS NULL) = (value_kv IS NULL))
  )`,
  `CREATE TABLE IF NOT EXISTS admin_passkey (
    credential_id      TEXT PRIMARY KEY,
    public_key         TEXT NOT NULL,
    sign_count         INTEGER NOT NULL,
    transports         TEXT,
    recovery_hash      TEXT NOT NULL,
    recovery_used_at   INTEGER,
    created_at         INTEGER NOT NULL,
    last_used_at       INTEGER
  )`,
];

export async function resetV1Schema(db: D1Database): Promise<void> {
  // Enable FK enforcement — SQLite requires this per-connection.
  await db.prepare('PRAGMA foreign_keys = ON').run();
  for (const table of V1_TABLES) {
    await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  }
  for (const stmt of V1_SCHEMA_STATEMENTS) {
    await db.prepare(stmt).run();
  }
}

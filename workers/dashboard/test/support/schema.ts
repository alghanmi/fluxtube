// Test-side schema bootstrap.
//
// vitest-pool-workers gives each test a fresh in-memory D1, but doesn't run
// the migrations for us. We could `exec()` the migration file, but D1's
// `.exec()` chokes on multi-line CREATE bodies (real bug — same one that
// forced auth.test.ts to inline its own DDL). Simplest workable path:
// re-declare the tables here in the exact shape of the migration files,
// one `.prepare().run()` per table.
//
// Keep in sync with:
//   workers/sync/migrations/0001_initial.sql  (queue table)
//   workers/sync/migrations/0002_v1_init.sql  (v1 tables)

export async function resetV1Schema(db: D1Database): Promise<void> {
  await db.prepare('DROP TABLE IF EXISTS mapping_history').run();
  await db.prepare('DROP TABLE IF EXISTS mappings').run();
  await db.prepare('DROP TABLE IF EXISTS config').run();
  await db.prepare('DROP TABLE IF EXISTS miniflux_instances').run();
  await db.prepare('DROP TABLE IF EXISTS admin_passkey').run();

  await db
    .prepare(
      `CREATE TABLE miniflux_instances (
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
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE mappings (
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
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE mapping_history (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_json  TEXT    NOT NULL,
        actor          TEXT    NOT NULL,
        created_at     INTEGER NOT NULL
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE config (
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
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE admin_passkey (
        credential_id      TEXT PRIMARY KEY,
        public_key         TEXT NOT NULL,
        sign_count         INTEGER NOT NULL,
        transports         TEXT,
        recovery_hash      TEXT NOT NULL,
        recovery_used_at   INTEGER,
        created_at         INTEGER NOT NULL,
        last_used_at       INTEGER
      )`,
    )
    .run();
}

/**
 * Base64-encoded 32-byte key + a keychain JSON string using version 1.
 * Reused across encryption-touching tests so we don't have to generate a
 * fresh key in every `beforeEach`.
 */
export const TEST_KEYCHAIN_JSON = JSON.stringify({
  current: 1,
  keys: { '1': 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' },
});

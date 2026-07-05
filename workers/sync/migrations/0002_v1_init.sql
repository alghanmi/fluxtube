-- v1 dashboard schema. Layers on top of the existing `queue` table
-- (0001_initial.sql). All tables here are read/write by BOTH workers:
--
--   * workers/sync    — Phase 3 dual-mode config loader
--   * workers/dashboard — Phase 4 auth + mapping UI + Phase 5 R2 backup
--
-- All times are unix seconds UTC. All identifiers are snake_case in SQL,
-- camelCase in the repo modules (see workers/sync/src/repos/).

-- ── miniflux_instances ──────────────────────────────────────────────────
-- Multi-Miniflux support: FluxTube v1 polls N Miniflux servers per instance.
-- The API token is encrypted at rest — (ct, iv, kv) triple lets the operator
-- rotate the encryption key without re-writing rows in a single transaction
-- (dashboard walks + re-encrypts via POST /api/config/rotate-keys).
CREATE TABLE miniflux_instances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name    TEXT    NOT NULL,
  url             TEXT    NOT NULL,
  api_token_ct    TEXT    NOT NULL,
  api_token_iv    TEXT    NOT NULL,
  api_token_kv    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(url)
);

-- ── mappings ────────────────────────────────────────────────────────────
-- Replaces the v0 CATEGORY_PLAYLIST_MAPPING env var. ON DELETE CASCADE from
-- miniflux_instances so removing a server removes its mappings atomically.
CREATE TABLE mappings (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  miniflux_instance_id   INTEGER NOT NULL
                                 REFERENCES miniflux_instances(id) ON DELETE CASCADE,
  miniflux_category      TEXT    NOT NULL,
  youtube_playlist_id    TEXT    NOT NULL,
  skip_shorts            INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  UNIQUE(miniflux_instance_id, miniflux_category, youtube_playlist_id)
);
CREATE INDEX idx_mappings_instance ON mappings(miniflux_instance_id);
CREATE INDEX idx_mappings_category ON mappings(miniflux_category);

-- ── mapping_history ─────────────────────────────────────────────────────
-- Append-only. UI shows the last `history_window` snapshots (config table).
-- Phase 4 `PUT /api/mappings` writes a snapshot before mutation; the UI
-- Version History screen restores from any row.
CREATE TABLE mapping_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_json  TEXT    NOT NULL,
  actor          TEXT    NOT NULL,   -- 'ui' | 'restore' | 'migration'
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_mapping_history_created ON mapping_history(created_at DESC);

-- ── config ──────────────────────────────────────────────────────────────
-- Scalar app config. Every row is EITHER plain (value != NULL, ct/iv/kv NULL)
-- OR encrypted (value NULL, ct/iv/kv all NOT NULL). Enforced by CHECK.
--
-- Known keys (populated by workers/dashboard as features come online):
--   youtube_refresh_token         (encrypted)
--   sync_log_level                (plain: 'debug' | 'info' | 'warn' | 'error')
--   history_window                (plain: integer, default 10)
--   backup_last_success_at        (plain: unix seconds)
--   backup_last_failure_at        (plain: unix seconds)
CREATE TABLE config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  value_ct    TEXT,
  value_iv    TEXT,
  value_kv    INTEGER,
  updated_at  INTEGER NOT NULL,
  CHECK ((value IS NOT NULL) <> (value_ct IS NOT NULL)),
  CHECK ((value_ct IS NULL) = (value_iv IS NULL)),
  CHECK ((value_ct IS NULL) = (value_kv IS NULL))
);

-- ── admin_passkey ───────────────────────────────────────────────────────
-- Single-row-by-convention (multi-passkey single-user is a future extension).
-- The row's existence is the "D1-managed mode" gate: workers/sync's dual-mode
-- config loader consults this table, not env vars, iff a row exists.
--
--   SELECT COUNT(*) FROM admin_passkey > 0  →  D1-managed mode
--   (env-var config strictly ignored)
CREATE TABLE admin_passkey (
  credential_id      TEXT PRIMARY KEY,
  public_key         TEXT NOT NULL,
  sign_count         INTEGER NOT NULL,
  transports         TEXT,                       -- JSON array or NULL
  recovery_hash      TEXT NOT NULL,              -- SHA-256 hex of one-time code
  recovery_used_at   INTEGER,                    -- audit: when /api/auth/recovery ran
  created_at         INTEGER NOT NULL,
  last_used_at       INTEGER
);

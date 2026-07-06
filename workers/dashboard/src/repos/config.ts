// Repo for the `config` D1 table. Every row is EITHER plain OR encrypted —
// enforced by CHECK constraints in the schema. This repo exposes typed
// getters/setters for each shape; encryption is done by callers via Phase 2's
// crypto util.
//
// Known keys (populated by workers/dashboard as features come online):
//   youtube_refresh_token         (encrypted)
//   sync_log_level                (plain)
//   history_window                (plain)
//   backup_last_success_at        (plain)
//   backup_last_failure_at        (plain)

export interface PlainConfigRow {
  key: string;
  value: string;
  updatedAt: number;
}

export interface EncryptedConfigRow {
  key: string;
  ct: string;
  iv: string;
  kv: number;
  updatedAt: number;
}

interface Row {
  key: string;
  value: string | null;
  value_ct: string | null;
  value_iv: string | null;
  value_kv: number | null;
  updated_at: number;
}

export class ConfigRepo {
  constructor(private readonly db: D1Database) {}

  /** Returns the plaintext value for a plain-only key, or null. */
  async getPlain(key: string): Promise<PlainConfigRow | null> {
    const r = await this.getRaw(key);
    if (!r || r.value === null) return null;
    return { key: r.key, value: r.value, updatedAt: r.updated_at };
  }

  /** Returns the (ct, iv, kv) triple for an encrypted key, or null. */
  async getEncrypted(key: string): Promise<EncryptedConfigRow | null> {
    const r = await this.getRaw(key);
    if (!r || r.value_ct === null || r.value_iv === null || r.value_kv === null) return null;
    return {
      key: r.key,
      ct: r.value_ct,
      iv: r.value_iv,
      kv: r.value_kv,
      updatedAt: r.updated_at,
    };
  }

  async has(key: string): Promise<boolean> {
    const r = await this.db
      .prepare('SELECT 1 AS x FROM config WHERE key = ? LIMIT 1')
      .bind(key)
      .first<{ x: number }>();
    return r !== null;
  }

  /** Upsert a plain value. Nulls out the encrypted columns per CHECK. */
  async setPlain(key: string, value: string, updatedAt: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO config (key, value, value_ct, value_iv, value_kv, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           value_ct = NULL,
           value_iv = NULL,
           value_kv = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(key, value, updatedAt)
      .run();
  }

  /** Upsert an encrypted value. Nulls out `value` per CHECK. */
  async setEncrypted(
    key: string,
    ct: string,
    iv: string,
    kv: number,
    updatedAt: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO config (key, value, value_ct, value_iv, value_kv, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = NULL,
           value_ct = excluded.value_ct,
           value_iv = excluded.value_iv,
           value_kv = excluded.value_kv,
           updated_at = excluded.updated_at`,
      )
      .bind(key, ct, iv, kv, updatedAt)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM config WHERE key = ?').bind(key).run();
  }

  private async getRaw(key: string): Promise<Row | null> {
    return await this.db
      .prepare('SELECT * FROM config WHERE key = ?')
      .bind(key)
      .first<Row>();
  }
}

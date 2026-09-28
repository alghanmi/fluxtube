// Re-encrypt every at-rest secret under the keychain's `current` version.
//
// Encrypted columns (the complete set — keep in sync with the migrations):
//   miniflux_instances.api_token_{ct,iv,kv}
//   config.value_{ct,iv,kv}            (rows where value_ct IS NOT NULL)
//
// All-or-nothing: every row that needs rotating is decrypted BEFORE anything
// is written. If any row can't be decrypted (its key version was already
// dropped from D1_KEYCHAIN, or the ciphertext is corrupt), nothing is written
// and the failures are returned, so the operator can put the old key back
// instead of discovering half-rotated data later. The writes then go out in a
// single D1 batch, which D1 runs as one transaction.
//
// Idempotent: rows already at `current` are skipped, so a re-run after a
// success is a no-op and a re-run after a fix picks up where it left off.

import { decrypt, encrypt, type Keychain } from './crypto';

export interface RotationFailure {
  table: 'miniflux_instances' | 'config';
  id: string;
  kv: number;
  message: string;
}

export type RotationResult =
  | { ok: true; current: number; rotated: number; alreadyCurrent: number }
  | { ok: false; current: number; failed: RotationFailure[] };

interface EncryptedRow {
  table: 'miniflux_instances' | 'config';
  id: string;
  ct: string;
  iv: string;
  kv: number;
}

export async function rotateKeys(
  db: D1Database,
  keychain: Keychain,
  now: number,
): Promise<RotationResult> {
  const rows = await loadEncryptedRows(db);
  const current = keychain.current;

  const pending: Array<{ row: EncryptedRow; plaintext: string }> = [];
  const failed: RotationFailure[] = [];
  let alreadyCurrent = 0;

  for (const row of rows) {
    if (row.kv === current) {
      alreadyCurrent++;
      continue;
    }
    try {
      pending.push({ row, plaintext: await decrypt(row, keychain) });
    } catch (err) {
      failed.push({
        table: row.table,
        id: row.id,
        kv: row.kv,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failed.length > 0) return { ok: false, current, failed };
  if (pending.length === 0) return { ok: true, current, rotated: 0, alreadyCurrent };

  // `AND ..._kv = ?` makes each write conditional on the row still holding
  // the version we decrypted, so a concurrent credential edit isn't
  // overwritten with a stale plaintext.
  const statements: D1PreparedStatement[] = [];
  for (const { row, plaintext } of pending) {
    const enc = await encrypt(plaintext, keychain);
    statements.push(
      row.table === 'miniflux_instances'
        ? db
            .prepare(
              `UPDATE miniflux_instances
                 SET api_token_ct = ?, api_token_iv = ?, api_token_kv = ?, updated_at = ?
               WHERE id = ? AND api_token_kv = ?`,
            )
            .bind(enc.ct, enc.iv, enc.kv, now, Number(row.id), row.kv)
        : db
            .prepare(
              `UPDATE config
                 SET value_ct = ?, value_iv = ?, value_kv = ?, updated_at = ?
               WHERE key = ? AND value_kv = ?`,
            )
            .bind(enc.ct, enc.iv, enc.kv, now, row.id, row.kv),
    );
  }
  await db.batch(statements);

  return { ok: true, current, rotated: pending.length, alreadyCurrent };
}

async function loadEncryptedRows(db: D1Database): Promise<EncryptedRow[]> {
  const instances = await db
    .prepare(
      'SELECT id, api_token_ct AS ct, api_token_iv AS iv, api_token_kv AS kv FROM miniflux_instances',
    )
    .all<{ id: number; ct: string; iv: string; kv: number }>();
  const config = await db
    .prepare(
      'SELECT key AS id, value_ct AS ct, value_iv AS iv, value_kv AS kv FROM config WHERE value_ct IS NOT NULL',
    )
    .all<{ id: string; ct: string; iv: string; kv: number }>();
  return [
    ...instances.results.map((r) => ({
      table: 'miniflux_instances' as const,
      ...r,
      id: String(r.id),
    })),
    ...config.results.map((r) => ({ table: 'config' as const, ...r })),
  ];
}

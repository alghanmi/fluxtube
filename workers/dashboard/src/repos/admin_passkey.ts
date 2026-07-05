// Repo for the `admin_passkey` D1 table.
//
// The row's EXISTENCE is the D1-managed-mode gate — workers/sync's dual-mode
// config loader (Phase 3) calls `count()` and switches read paths based on
// the result. That's why this repo carries an intentionally minimal API:
//   - count()              → is the instance claimed?
//   - insert(row)          → register a new credential (Phase 4 auth flow)
//   - get(credentialId)    → look up by credential
//   - listAll()            → the UI's registered-credentials list
//   - updateSignCount()    → WebAuthn's per-use counter bump
//   - recordRecovery(id)   → audit stamp
//   - deleteAll(recoveryHash) → recovery flow: wipe iff hash matches

export interface AdminPasskeyRow {
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[] | null;
  recoveryHash: string;
  recoveryUsedAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface AdminPasskeyInsert {
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[] | null;
  recoveryHash: string;
  createdAt: number;
}

interface Row {
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string | null;
  recovery_hash: string;
  recovery_used_at: number | null;
  created_at: number;
  last_used_at: number | null;
}

function toModel(r: Row): AdminPasskeyRow {
  return {
    credentialId: r.credential_id,
    publicKey: r.public_key,
    signCount: r.sign_count,
    transports: r.transports === null ? null : (JSON.parse(r.transports) as string[]),
    recoveryHash: r.recovery_hash,
    recoveryUsedAt: r.recovery_used_at,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

export class AdminPasskeyRepo {
  constructor(private readonly db: D1Database) {}

  async count(): Promise<number> {
    const r = await this.db
      .prepare('SELECT COUNT(*) AS n FROM admin_passkey')
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async insert(row: AdminPasskeyInsert): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO admin_passkey
           (credential_id, public_key, sign_count, transports, recovery_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.credentialId,
        row.publicKey,
        row.signCount,
        row.transports === null ? null : JSON.stringify(row.transports),
        row.recoveryHash,
        row.createdAt,
      )
      .run();
  }

  async get(credentialId: string): Promise<AdminPasskeyRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM admin_passkey WHERE credential_id = ?')
      .bind(credentialId)
      .first<Row>();
    return r ? toModel(r) : null;
  }

  async listAll(): Promise<AdminPasskeyRow[]> {
    const res = await this.db
      .prepare('SELECT * FROM admin_passkey ORDER BY created_at ASC')
      .all<Row>();
    return (res.results ?? []).map(toModel);
  }

  async updateSignCount(
    credentialId: string,
    signCount: number,
    lastUsedAt: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE admin_passkey
         SET sign_count = ?, last_used_at = ?
         WHERE credential_id = ?`,
      )
      .bind(signCount, lastUsedAt, credentialId)
      .run();
  }

  /**
   * Recovery flow (Phase 4 POST /api/auth/recovery):
   *   1. Client posts a plaintext recovery code.
   *   2. Handler hashes it, then calls `deleteAllMatching(hash)`.
   *   3. If the hash matches ANY row, the WHOLE table wipes and the return
   *      value is > 0 — the client re-runs the /claim ceremony with a fresh
   *      passkey. If no match, returns 0 and the caller returns 401.
   *
   * Recovery is intentionally "wipe everything, re-claim from scratch" so a
   * lost-device attacker with only some of the passkeys can't still log in
   * via a partial match on one of the others.
   */
  async deleteAllMatching(recoveryHash: string, at: number): Promise<number> {
    // Stamp audit trail before the wipe so an operator can later see whether
    // recovery was ever used (rows are gone, but the fact of use is preserved
    // in Grafana logs from this call — Phase 8 wires the alert).
    const stamp = await this.db
      .prepare(
        `UPDATE admin_passkey SET recovery_used_at = ? WHERE recovery_hash = ?`,
      )
      .bind(at, recoveryHash)
      .run();
    const affected = stamp.meta.changes ?? 0;
    if (affected > 0) {
      await this.db.prepare('DELETE FROM admin_passkey').run();
    }
    return affected;
  }
}

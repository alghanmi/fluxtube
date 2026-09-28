// Non-encrypted config CRUD.
//
//   GET  /api/config              → returns the plain-value config rows
//   PUT  /api/config/:key         → upsert a plain value (whitelist-gated)
//   POST /api/config/rotate-keys  → re-encrypt every secret under the
//                                   keychain's current version (see
//                                   ../rotate_keys.ts)
//
// Encrypted keys (youtube_refresh_token) are set via the OAuth flow in
// Phase 4d, never through PUT. Reserved plain keys (backup_last_success_at,
// backup_last_failure_at) are written by the backup module in Phase 5 and
// aren't user-editable either.

import type { Hono } from 'hono';
import { requireAuth } from '../auth/require_auth';
import type { DashboardAuthEnv } from '../auth/require_auth';
import { parseKeychain } from '../crypto';
import { ConfigRepo } from '../repos/config';
import { rotateKeys } from '../rotate_keys';

export interface ConfigEnv extends DashboardAuthEnv {
  DB: D1Database;
  D1_KEYCHAIN?: string;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

// Keys the operator is allowed to write via PUT /api/config/:key. Encrypted
// keys and system-managed keys (backup timestamps) are deliberately not here.
type WritableKey = 'sync_log_level' | 'history_window';
const WRITABLE_KEYS = new Set<WritableKey>(['sync_log_level', 'history_window']);

// Keys the operator is allowed to READ via GET /api/config. Encrypted keys
// are omitted (the API surfaces "connected: bool" per feature via Phase 4d
// endpoints instead of exposing ciphertext).
const READABLE_KEYS = [
  'sync_log_level',
  'history_window',
  'backup_last_success_at',
  'backup_last_failure_at',
] as const;

export function attachConfigRoutes(app: Hono<{ Bindings: ConfigEnv }>): void {
  // Operator route: accepts the Bearer token so rotation can run straight
  // after `make worker-secrets` pushes a new keychain. It can't read or
  // redirect any credential — only re-encrypt in place.
  //
  //   200 { current, rotated, alreadyCurrent }
  //   500 { error: 'rotation_incomplete', current, failed: [...] }  — nothing written
  //   500 { error: 'keychain_not_configured' | 'keychain_invalid: …' }
  app.post('/api/config/rotate-keys', async (c) => {
    const session = await requireAuth(c.req.raw, c.env, { bearer: true });
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    if (!c.env.D1_KEYCHAIN) return c.json({ error: 'keychain_not_configured' }, 500);
    let keychain;
    try {
      keychain = parseKeychain(c.env.D1_KEYCHAIN);
    } catch (err) {
      return c.json(
        { error: `keychain_invalid: ${err instanceof Error ? err.message : String(err)}` },
        500,
      );
    }
    const result = await rotateKeys(c.env.DB, keychain, nowSec());
    if (!result.ok) {
      return c.json(
        { error: 'rotation_incomplete', current: result.current, failed: result.failed },
        500,
      );
    }
    return c.json({
      current: result.current,
      rotated: result.rotated,
      alreadyCurrent: result.alreadyCurrent,
    });
  });

  app.get('/api/config', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const repo = new ConfigRepo(c.env.DB);
    const out: Record<string, string | null> = {};
    for (const key of READABLE_KEYS) {
      const row = await repo.getPlain(key);
      out[key] = row?.value ?? null;
    }
    return c.json({ config: out });
  });

  app.put('/api/config/:key', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const key = c.req.param('key');
    if (!isWritable(key)) return c.json({ error: 'key_not_writable' }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const rawValue = (body as { value?: unknown }).value;

    const validated = validateValue(key, rawValue);
    if (!validated.ok) return c.json({ error: validated.error }, 400);

    await new ConfigRepo(c.env.DB).setPlain(key, validated.value, nowSec());
    return c.json({ key, value: validated.value });
  });
}

function isWritable(key: string): key is WritableKey {
  return WRITABLE_KEYS.has(key as WritableKey);
}

type ValidateResult = { ok: true; value: string } | { ok: false; error: string };

function validateValue(key: WritableKey, value: unknown): ValidateResult {
  if (key === 'sync_log_level') {
    if (typeof value !== 'string' || !LOG_LEVELS.includes(value as LogLevel)) {
      return { ok: false, error: 'invalid_log_level' };
    }
    return { ok: true, value };
  }
  if (key === 'history_window') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
      return { ok: false, error: 'invalid_history_window' };
    }
    return { ok: true, value: String(value) };
  }
  // Exhaustive — every WritableKey is handled above.
  return { ok: false, error: 'unhandled_key' };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

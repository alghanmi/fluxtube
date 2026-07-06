// Miniflux instance CRUD.
//
//   GET    /api/miniflux/instances       → list (api tokens never returned)
//   POST   /api/miniflux/instances       → add; encrypts api_token
//   PUT    /api/miniflux/instances/:id   → partial update; re-encrypts if
//                                          api_token is supplied
//   DELETE /api/miniflux/instances/:id   → cascades to mappings via FK
//
// The stored `api_token_ct/_iv/_kv` triple is opaque to the outside world:
// GET responses never include ciphertext, and PUT accepts only plaintext
// which is encrypted server-side under the current keychain version.

import type { Hono } from 'hono';
import { requireAuth } from '../auth/require_auth';
import type { DashboardAuthEnv } from '../auth/require_auth';
import { encrypt, parseKeychain } from '../crypto';
import type { Keychain } from '../crypto';
import { MinifluxInstancesRepo } from '../repos/miniflux_instances';
import type { MinifluxInstanceUpdate } from '../repos/miniflux_instances';

export interface MinifluxInstancesEnv extends DashboardAuthEnv {
  DB: D1Database;
  D1_KEYCHAIN?: string;
}

export function attachMinifluxInstanceRoutes(
  app: Hono<{ Bindings: MinifluxInstancesEnv }>,
): void {
  app.get('/api/miniflux/instances', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const rows = await new MinifluxInstancesRepo(c.env.DB).list();
    return c.json({
      instances: rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        url: r.url,
        // api_token intentionally omitted — never leaves the Worker
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  });

  app.post('/api/miniflux/instances', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const kc = loadKeychain(c.env);
    if (!kc.ok) return c.json({ error: kc.error }, 500);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = parseCreateBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const repo = new MinifluxInstancesRepo(c.env.DB);
    if (await repo.getByUrl(parsed.url)) {
      return c.json({ error: 'url_already_exists' }, 409);
    }

    const encrypted = await encrypt(parsed.apiToken, kc.keychain);
    const now = nowSec();
    const id = await repo.insert({
      displayName: parsed.displayName,
      url: parsed.url,
      apiTokenCt: encrypted.ct,
      apiTokenIv: encrypted.iv,
      apiTokenKv: encrypted.kv,
      createdAt: now,
      updatedAt: now,
    });

    return c.json(
      { id, displayName: parsed.displayName, url: parsed.url, createdAt: now, updatedAt: now },
      201,
    );
  });

  app.put('/api/miniflux/instances/:id', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);

    const repo = new MinifluxInstancesRepo(c.env.DB);
    const existing = await repo.get(id);
    if (!existing) return c.json({ error: 'not_found' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = parseUpdateBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    if (parsed.url !== undefined && parsed.url !== existing.url) {
      const clash = await repo.getByUrl(parsed.url);
      if (clash && clash.id !== id) return c.json({ error: 'url_already_exists' }, 409);
    }

    const now = nowSec();
    const patch: MinifluxInstanceUpdate = { updatedAt: now };
    if (parsed.displayName !== undefined) patch.displayName = parsed.displayName;
    if (parsed.url !== undefined) patch.url = parsed.url;
    if (parsed.apiToken !== undefined) {
      const kc = loadKeychain(c.env);
      if (!kc.ok) return c.json({ error: kc.error }, 500);
      const encrypted = await encrypt(parsed.apiToken, kc.keychain);
      patch.apiTokenCt = encrypted.ct;
      patch.apiTokenIv = encrypted.iv;
      patch.apiTokenKv = encrypted.kv;
    }
    await repo.update(id, patch);

    const updated = await repo.get(id);
    if (!updated) return c.json({ error: 'not_found_after_update' }, 500);
    return c.json({
      id: updated.id,
      displayName: updated.displayName,
      url: updated.url,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  });

  app.delete('/api/miniflux/instances/:id', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);

    const repo = new MinifluxInstancesRepo(c.env.DB);
    const existing = await repo.get(id);
    if (!existing) return c.json({ error: 'not_found' }, 404);

    await repo.delete(id);
    return c.json({ ok: true });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

type KeychainResult =
  | { ok: true; keychain: Keychain }
  | { ok: false; error: string };

function loadKeychain(env: MinifluxInstancesEnv): KeychainResult {
  if (!env.D1_KEYCHAIN) return { ok: false, error: 'keychain_not_configured' };
  try {
    return { ok: true, keychain: parseKeychain(env.D1_KEYCHAIN) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `keychain_invalid: ${err.message}` : 'keychain_invalid',
    };
  }
}

interface CreateBody {
  ok: true;
  displayName: string;
  url: string;
  apiToken: string;
}
type CreateResult = CreateBody | { ok: false; error: string };

function parseCreateBody(body: unknown): CreateResult {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid_body' };
  const e = body as Record<string, unknown>;
  if (typeof e.displayName !== 'string' || e.displayName.length === 0) {
    return { ok: false, error: 'missing_or_invalid_displayName' };
  }
  if (typeof e.url !== 'string' || !isHttpUrl(e.url)) {
    return { ok: false, error: 'missing_or_invalid_url' };
  }
  if (typeof e.apiToken !== 'string' || e.apiToken.length === 0) {
    return { ok: false, error: 'missing_or_invalid_apiToken' };
  }
  return { ok: true, displayName: e.displayName, url: e.url, apiToken: e.apiToken };
}

interface UpdateBody {
  ok: true;
  displayName?: string;
  url?: string;
  apiToken?: string;
}
type UpdateResult = UpdateBody | { ok: false; error: string };

function parseUpdateBody(body: unknown): UpdateResult {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid_body' };
  const e = body as Record<string, unknown>;
  const out: UpdateBody = { ok: true };
  if (e.displayName !== undefined) {
    if (typeof e.displayName !== 'string' || e.displayName.length === 0) {
      return { ok: false, error: 'invalid_displayName' };
    }
    out.displayName = e.displayName;
  }
  if (e.url !== undefined) {
    if (typeof e.url !== 'string' || !isHttpUrl(e.url)) {
      return { ok: false, error: 'invalid_url' };
    }
    out.url = e.url;
  }
  if (e.apiToken !== undefined) {
    if (typeof e.apiToken !== 'string' || e.apiToken.length === 0) {
      return { ok: false, error: 'invalid_apiToken' };
    }
    out.apiToken = e.apiToken;
  }
  if (out.displayName === undefined && out.url === undefined && out.apiToken === undefined) {
    return { ok: false, error: 'no_fields_to_update' };
  }
  return out;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

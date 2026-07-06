// GET /api/miniflux/categories?instance_id=N
//
// Live fetch against the stored Miniflux instance's /v1/categories endpoint.
// The api_token is decrypted per-request from the D1 row's (ct, iv, kv)
// triple — never cached in Worker memory, never returned to the client.
//
// A dedicated client class would be overkill for a single API call; we
// inline the fetch here.

import type { Hono } from 'hono';
import { requireAuth } from '../auth/require_auth';
import type { DashboardAuthEnv } from '../auth/require_auth';
import { decrypt, parseKeychain } from '../crypto';
import { MinifluxInstancesRepo } from '../repos/miniflux_instances';

export interface MinifluxCategoriesEnv extends DashboardAuthEnv {
  DB: D1Database;
  D1_KEYCHAIN?: string;
}

const FETCH_TIMEOUT_MS = 10_000;

interface Category {
  id: number;
  title: string;
}

export function attachMinifluxCategoriesRoutes(
  app: Hono<{ Bindings: MinifluxCategoriesEnv }>,
): void {
  app.get('/api/miniflux/categories', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const raw = c.req.query('instance_id');
    const instanceId = Number(raw);
    if (!Number.isInteger(instanceId) || instanceId <= 0) {
      return c.json({ error: 'invalid_instance_id' }, 400);
    }

    if (!c.env.D1_KEYCHAIN) return c.json({ error: 'keychain_not_configured' }, 500);

    const row = await new MinifluxInstancesRepo(c.env.DB).get(instanceId);
    if (!row) return c.json({ error: 'instance_not_found' }, 404);

    let apiToken: string;
    try {
      const keychain = parseKeychain(c.env.D1_KEYCHAIN);
      apiToken = await decrypt(
        { ct: row.apiTokenCt, iv: row.apiTokenIv, kv: row.apiTokenKv },
        keychain,
      );
    } catch (err) {
      return c.json(
        {
          error: 'decrypt_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }

    const upstream = await fetchMinifluxCategories(row.url, apiToken);
    if (!upstream.ok) {
      return c.json(
        {
          error: 'miniflux_fetch_failed',
          status: upstream.status,
          message: upstream.message,
        },
        502,
      );
    }
    return c.json({ categories: upstream.categories });
  });
}

type FetchResult =
  | { ok: true; categories: Category[] }
  | { ok: false; status: number; message: string };

async function fetchMinifluxCategories(baseUrl: string, apiToken: string): Promise<FetchResult> {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${trimmed}/v1/categories`, {
      method: 'GET',
      headers: {
        'X-Auth-Token': apiToken,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok) {
    let bodyPreview = '';
    try {
      bodyPreview = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    return { ok: false, status: res.status, message: bodyPreview };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: res.status, message: 'response_not_json' };
  }
  if (!Array.isArray(data)) {
    return { ok: false, status: res.status, message: 'response_not_array' };
  }
  const categories: Category[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (typeof row !== 'object' || row === null) {
      return { ok: false, status: res.status, message: `category[${i}] not an object` };
    }
    const obj = row as Record<string, unknown>;
    if (typeof obj.id !== 'number' || typeof obj.title !== 'string') {
      return { ok: false, status: res.status, message: `category[${i}] invalid shape` };
    }
    categories.push({ id: obj.id, title: obj.title });
  }
  return { ok: true, categories };
}

import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { encrypt, parseKeychain } from '../../src/crypto';
import { MinifluxInstancesRepo } from '../../src/repos/miniflux_instances';
import { resetV1Schema, TEST_KEYCHAIN_JSON } from '../support/schema';

const db = (env as unknown as { DB: D1Database }).DB;

const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

type AppEnv = Parameters<typeof app.fetch>[1];

function testEnv(overrides: Record<string, unknown> = {}): AppEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
    D1_KEYCHAIN: TEST_KEYCHAIN_JSON,
    ...overrides,
  } as unknown as AppEnv;
}

async function sessionCookie(): Promise<string> {
  const token = await signSession(
    { sub: 'admin', credentialId: 'cred-1', issuedAt: Math.floor(Date.now() / 1000) },
    HMAC_KEY,
  );
  return `fluxtube_session=${token}`;
}

async function seedInstance(url: string, apiTokenPlain: string): Promise<number> {
  const kc = parseKeychain(TEST_KEYCHAIN_JSON);
  const enc = await encrypt(apiTokenPlain, kc);
  return await new MinifluxInstancesRepo(db).insert({
    displayName: `Instance ${url}`,
    url,
    apiTokenCt: enc.ct,
    apiTokenIv: enc.iv,
    apiTokenKv: enc.kv,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
}

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await resetV1Schema(db);
});

afterEach(() => {
  vi.stubGlobal('fetch', originalFetch);
  vi.restoreAllMocks();
});

describe('GET /api/miniflux/categories', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/categories?instance_id=1'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('400 on missing/invalid instance_id', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/categories?instance_id=nope', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('404 when the instance does not exist', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/categories?instance_id=999', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('500 when keychain not configured', async () => {
    const id = await seedInstance('https://home.example', 'tkn');
    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/categories?instance_id=${id}`, {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ D1_KEYCHAIN: undefined }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
  });

  it('proxies decrypted api_token and returns categories on 200', async () => {
    const id = await seedInstance('https://home.example', 'super-secret-tkn');
    const stub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const reqUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      expect(reqUrl).toBe('https://home.example/v1/categories');
      const token = new Headers(init?.headers).get('X-Auth-Token');
      expect(token).toBe('super-secret-tkn');
      return new Response(
        JSON.stringify([
          { id: 1, title: 'Videos' },
          { id: 2, title: 'Talks' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', stub);

    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/categories?instance_id=${id}`, {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { categories: Array<{ id: number; title: string }> };
    expect(body.categories).toEqual([
      { id: 1, title: 'Videos' },
      { id: 2, title: 'Talks' },
    ]);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('502 when upstream returns non-2xx', async () => {
    const id = await seedInstance('https://home.example', 't');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    );
    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/categories?instance_id=${id}`, {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; status: number };
    expect(body.error).toBe('miniflux_fetch_failed');
    expect(body.status).toBe(401);
  });

  it('502 when upstream body is malformed', async () => {
    const id = await seedInstance('https://home.example', 't');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 200 })),
    );
    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/categories?instance_id=${id}`, {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(502);
  });
});

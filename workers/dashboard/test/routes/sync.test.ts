import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { resetV1Schema } from '../support/schema';

const db = (env as unknown as { DB: D1Database }).DB;

const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const BEARER_TOKEN = 'super-secret-manual-trigger-token';

type AppEnv = Parameters<typeof app.fetch>[1];

function testEnv(overrides: Record<string, unknown> = {}): AppEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
    MANUAL_TRIGGER_TOKEN: BEARER_TOKEN,
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

/** Stub Fetcher — captures the request the dashboard forwards. */
function stubFetcher(response: Response): {
  fetcher: Fetcher;
  lastRequest: () => Request | null;
} {
  let last: Request | null = null;
  const fetcher = {
    fetch: vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      last = new Request(input, init);
      return response.clone();
    }),
  } as unknown as Fetcher;
  return { fetcher, lastRequest: () => last };
}

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('POST /api/sync/trigger', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/sync/trigger', { method: 'POST' }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('503 when SYNC binding is missing', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/sync/trigger', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('sync_binding_not_configured');
  });

  it('503 when MANUAL_TRIGGER_TOKEN is missing', async () => {
    const { fetcher } = stubFetcher(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await app.fetch(
      new Request('http://d.test/api/sync/trigger', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ SYNC: fetcher, MANUAL_TRIGGER_TOKEN: undefined }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(503);
  });

  it('forwards the request and re-attaches the bearer token', async () => {
    const { fetcher, lastRequest } = stubFetcher(
      new Response(JSON.stringify({ ok: true, ran: 3 }), { status: 200 }),
    );
    const res = await app.fetch(
      new Request('http://d.test/api/sync/trigger', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ SYNC: fetcher }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ran: number };
    expect(body.ok).toBe(true);
    expect(body.ran).toBe(3);

    const forwarded = lastRequest();
    if (!forwarded) throw new Error('sync fetcher was not invoked');
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('Authorization')).toBe(`Bearer ${BEARER_TOKEN}`);
    // URL host is arbitrary (service binding routes by binding, not host)
    // but the path must be /sync so the sync Worker's router matches.
    expect(new URL(forwarded.url).pathname).toBe('/sync');
  });

  it('passes through non-200 responses from the sync worker', async () => {
    const { fetcher } = stubFetcher(
      new Response(JSON.stringify({ error: 'nope' }), { status: 500 }),
    );
    const res = await app.fetch(
      new Request('http://d.test/api/sync/trigger', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ SYNC: fetcher }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('nope');
  });

  it('bearer-authed callers get the token replaced with the canonical value', async () => {
    const { fetcher, lastRequest } = stubFetcher(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const res = await app.fetch(
      new Request('http://d.test/api/sync/trigger', {
        method: 'POST',
        headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      }),
      testEnv({ SYNC: fetcher }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    // Even though the client sent BEARER_TOKEN itself, the forwarded header
    // is re-attached from env — not the client's echo.
    const req = lastRequest();
    if (!req) throw new Error('sync fetcher was not invoked');
    expect(req.headers.get('Authorization')).toBe(`Bearer ${BEARER_TOKEN}`);
  });
});

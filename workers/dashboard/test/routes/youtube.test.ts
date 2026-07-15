import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { decrypt, encrypt, parseKeychain } from '../../src/crypto';
import { ConfigRepo } from '../../src/repos/config';
import { resetV1Schema, TEST_KEYCHAIN_JSON } from '../support/schema';

const db = (env as unknown as { DB: D1Database }).DB;

const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

type AppEnv = Parameters<typeof app.fetch>[1];

function testEnv(overrides: Record<string, unknown> = {}): AppEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
    D1_KEYCHAIN: TEST_KEYCHAIN_JSON,
    RP_ID: 'dashboard.test',
    YOUTUBE_CLIENT_ID: 'client-id-xyz',
    YOUTUBE_CLIENT_SECRET: 'client-secret-xyz',
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

function extractState(res: Response): string {
  const loc = res.headers.get('Location');
  if (!loc) throw new Error('missing Location header');
  const state = new URL(loc).searchParams.get('state');
  if (!state) throw new Error('missing state param');
  return state;
}

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  await resetV1Schema(db);
});

afterEach(() => {
  vi.stubGlobal('fetch', originalFetch);
  vi.restoreAllMocks();
});

describe('GET /api/auth/youtube (begin)', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/youtube'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('500 when client id is missing', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/youtube', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ YOUTUBE_CLIENT_ID: undefined }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
  });

  it('302 redirects to Google with a signed state param', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/youtube', {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get('Location');
    if (!loc) throw new Error('missing Location header');
    const url = new URL(loc);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id-xyz');
    expect(url.searchParams.get('redirect_uri')).toBe('https://dashboard.test/api/auth/youtube/callback');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    const state = url.searchParams.get('state');
    if (!state) throw new Error('missing state param');
    // Signed shape: <payload>.<hmac-hex>
    expect(state.split('.').length).toBe(2);
  });
});

describe('GET /api/auth/youtube/callback', () => {
  // All callback exits are 302 redirects to /dashboard/oauth — the route
  // is a top-level browser navigation from accounts.google.com, so raw
  // JSON responses would leave the browser rendering a JSON blob. The
  // dedicated /dashboard/oauth page renders the Phase 10 success/error
  // splash from the ?state=(connected|denied)&reason=<code> params.

  it('redirects to /dashboard/oauth?state=denied&reason=invalid_state on bogus state', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/youtube/callback?code=abc&state=bogus.deadbeef', {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard/oauth?state=denied&reason=invalid_state');
  });

  it('redirects to /dashboard/oauth?state=denied&reason=missing_code_or_state when code is absent', async () => {
    const beginRes = await app.fetch(
      new Request('http://d.test/api/auth/youtube', {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    const state = extractState(beginRes);
    const res = await app.fetch(
      new Request(`http://d.test/api/auth/youtube/callback?state=${state}`, {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard/oauth?state=denied&reason=missing_code_or_state');
  });

  it('exchanges code, encrypts + stores the refresh token, redirects to /dashboard/oauth?state=connected', async () => {
    // Fresh state from begin so verify passes.
    const beginRes = await app.fetch(
      new Request('http://d.test/api/auth/youtube', {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    const state = extractState(beginRes);

    const stub = vi.fn(async (url: string | URL | Request) => {
      const reqUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      expect(reqUrl).toBe('https://oauth2.googleapis.com/token');
      return new Response(
        JSON.stringify({
          access_token: 'at-abc',
          refresh_token: 'rt-xyz-super-secret',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', stub);

    const res = await app.fetch(
      new Request(`http://d.test/api/auth/youtube/callback?code=CODE&state=${state}`, {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard/oauth?state=connected');

    // Stored + decryptable.
    const stored = await new ConfigRepo(db).getEncrypted('youtube_refresh_token');
    expect(stored).not.toBeNull();
    if (!stored) throw new Error('unreachable');
    const decrypted = await decrypt(
      { ct: stored.ct, iv: stored.iv, kv: stored.kv },
      parseKeychain(TEST_KEYCHAIN_JSON),
    );
    expect(decrypted).toBe('rt-xyz-super-secret');
  });

  it('redirects to /dashboard/oauth?state=denied&reason=token_exchange_failed when Google rejects the code', async () => {
    const beginRes = await app.fetch(
      new Request('http://d.test/api/auth/youtube', {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    const state = extractState(beginRes);

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const res = await app.fetch(
      new Request(`http://d.test/api/auth/youtube/callback?code=CODE&state=${state}`, {
        headers: { Cookie: await sessionCookie() },
        redirect: 'manual',
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/dashboard/oauth?state=denied&reason=token_exchange_failed');
  });
});

describe('GET /api/youtube/playlists', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/youtube/playlists'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('409 when not connected (no refresh token stored)', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/youtube/playlists', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
  });

  it('mints an access token and returns playlists on 200', async () => {
    // Seed encrypted refresh token.
    const kc = parseKeychain(TEST_KEYCHAIN_JSON);
    const enc = await encrypt('rt-stored', kc);
    await new ConfigRepo(db).setEncrypted(
      'youtube_refresh_token',
      enc.ct,
      enc.iv,
      enc.kv,
      1_700_000_000,
    );

    const stub = vi.fn(async (url: string | URL | Request) => {
      const reqUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (reqUrl.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'at-fresh', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (reqUrl.startsWith('https://www.googleapis.com/youtube/v3/playlists')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'PL-a',
                snippet: { title: 'Watch Later Manual' },
                contentDetails: { itemCount: 12 },
              },
              {
                id: 'PL-b',
                snippet: { title: 'Talks' },
                contentDetails: { itemCount: 3 },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${reqUrl}`);
    });
    vi.stubGlobal('fetch', stub);

    const res = await app.fetch(
      new Request('http://d.test/api/youtube/playlists', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      playlists: Array<{ id: string; title: string; itemCount: number }>;
    };
    expect(body.playlists).toEqual([
      { id: 'PL-a', title: 'Watch Later Manual', itemCount: 12 },
      { id: 'PL-b', title: 'Talks', itemCount: 3 },
    ]);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it('502 when the access token mint fails', async () => {
    const kc = parseKeychain(TEST_KEYCHAIN_JSON);
    const enc = await encrypt('rt-stored', kc);
    await new ConfigRepo(db).setEncrypted(
      'youtube_refresh_token',
      enc.ct,
      enc.iv,
      enc.kv,
      1_700_000_000,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const res = await app.fetch(
      new Request('http://d.test/api/youtube/playlists', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('access_token_failed');
  });
});

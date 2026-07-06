import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { ConfigRepo } from '../../src/repos/config';
import { resetV1Schema } from '../support/schema';

const db = (env as unknown as { DB: D1Database }).DB;

const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

type AppEnv = Parameters<typeof app.fetch>[1];

function testEnv(overrides: Record<string, unknown> = {}): AppEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
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

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('GET /api/config', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('returns nulls for unset keys', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config', { headers: { Cookie: await sessionCookie() } }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: Record<string, string | null> };
    expect(body.config).toEqual({
      sync_log_level: null,
      history_window: null,
      backup_last_success_at: null,
      backup_last_failure_at: null,
    });
  });

  it('returns stored plain values', async () => {
    await new ConfigRepo(db).setPlain('sync_log_level', 'debug', 1_700_000_000);
    await new ConfigRepo(db).setPlain('history_window', '20', 1_700_000_000);
    const res = await app.fetch(
      new Request('http://d.test/api/config', { headers: { Cookie: await sessionCookie() } }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: Record<string, string | null> };
    expect(body.config.sync_log_level).toBe('debug');
    expect(body.config.history_window).toBe('20');
  });
});

describe('PUT /api/config/:key', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config/sync_log_level', {
        method: 'PUT',
        body: JSON.stringify({ value: 'info' }),
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('400 on unknown key', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config/nope', {
        method: 'PUT',
        body: JSON.stringify({ value: 'x' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 on encrypted key (youtube_refresh_token)', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config/youtube_refresh_token', {
        method: 'PUT',
        body: JSON.stringify({ value: 'x' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 on system-managed backup keys', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config/backup_last_success_at', {
        method: 'PUT',
        body: JSON.stringify({ value: '1234567890' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 on invalid log level', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config/sync_log_level', {
        method: 'PUT',
        body: JSON.stringify({ value: 'trace' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 on invalid history_window (string, negative, huge)', async () => {
    for (const bad of ['20', -1, 0, 500]) {
      const res = await app.fetch(
        new Request('http://d.test/api/config/history_window', {
          method: 'PUT',
          body: JSON.stringify({ value: bad }),
          headers: { Cookie: await sessionCookie() },
        }),
        testEnv(),
        {} as ExecutionContext,
      );
      expect(res.status).toBe(400);
    }
  });

  it('200 on valid log level; persists', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config/sync_log_level', {
        method: 'PUT',
        body: JSON.stringify({ value: 'warn' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const row = await new ConfigRepo(db).getPlain('sync_log_level');
    expect(row?.value).toBe('warn');
  });

  it('200 on valid history_window; persists as string', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/config/history_window', {
        method: 'PUT',
        body: JSON.stringify({ value: 25 }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const row = await new ConfigRepo(db).getPlain('history_window');
    expect(row?.value).toBe('25');
  });
});

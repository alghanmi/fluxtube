import { env as testEnv } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { AdminPasskeyRepo } from '../src/repos/admin_passkey';
import type { Env } from '../src/types';
import { resetV1Schema } from './testdb';

// The Worker's fetch entrypoint must reject unauthenticated callers before
// it loads runtime config. The fixture puts the instance in D1-managed mode
// with no D1_KEYCHAIN, so config load is guaranteed to fail: an anonymous
// caller must see 401, never the 503 whose body describes the config state.

const db = (testEnv as unknown as { DB: D1Database }).DB;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function brokenD1ModeEnv(): Env {
  return {
    DB: db,
    MINIFLUX_URL: '',
    MINIFLUX_API_TOKEN: '',
    CATEGORY_PLAYLIST_MAPPING: '[]',
    YOUTUBE_CLIENT_ID: 'yt-cid',
    YOUTUBE_CLIENT_SECRET: 'yt-cs',
    YOUTUBE_REFRESH_TOKEN: '',
    MANUAL_TRIGGER_TOKEN: 'trigger',
    SYNC_LOG_LEVEL: 'error',
  };
}

beforeEach(async () => {
  await resetV1Schema(db);
  await new AdminPasskeyRepo(db).insert({
    credentialId: 'cred-test',
    publicKey: 'pk-test',
    signCount: 0,
    transports: null,
    recoveryHash: 'hash-test',
    createdAt: 1700000000,
  });
});

describe('fetch entrypoint — auth precedes config load', () => {
  it('returns 401 without a bearer token, even when config cannot load', async () => {
    const res = await worker.fetch(new Request('https://sync.test/audit'), brokenD1ModeEnv(), ctx);
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain('D1_KEYCHAIN');
  });

  it('returns 401 with a wrong bearer token', async () => {
    const res = await worker.fetch(
      new Request('https://sync.test/audit', { headers: { Authorization: 'Bearer nope' } }),
      brokenD1ModeEnv(),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('returns 503 config_unavailable to an authenticated caller', async () => {
    const res = await worker.fetch(
      new Request('https://sync.test/audit', { headers: { Authorization: 'Bearer trigger' } }),
      brokenD1ModeEnv(),
      ctx,
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('config_unavailable');
  });
});

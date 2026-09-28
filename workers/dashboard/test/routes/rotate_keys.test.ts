import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { decrypt, encrypt, parseKeychain } from '../../src/crypto';
import { ConfigRepo } from '../../src/repos/config';
import { MinifluxInstancesRepo } from '../../src/repos/miniflux_instances';
import { resetV1Schema, seedSessionPasskey } from '../support/schema';

const db = (env as unknown as { DB: D1Database }).DB;
const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const BEARER = 'operator-token';
const KEY_1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const KEY_2 = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';

const V1_ONLY = JSON.stringify({ current: 1, keys: { '1': KEY_1 } });
const V2_WITH_V1 = JSON.stringify({ current: 2, keys: { '1': KEY_1, '2': KEY_2 } });
const V2_ONLY = JSON.stringify({ current: 2, keys: { '2': KEY_2 } });

type AppEnv = Parameters<typeof app.fetch>[1];

function testEnv(keychain: string | undefined): AppEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
    MANUAL_TRIGGER_TOKEN: BEARER,
    D1_KEYCHAIN: keychain,
  } as unknown as AppEnv;
}

async function sessionCookie(): Promise<string> {
  await seedSessionPasskey(db);
  const token = await signSession(
    { sub: 'admin', credentialId: 'cred-1', issuedAt: Math.floor(Date.now() / 1000) },
    HMAC_KEY,
  );
  return `fluxtube_session=${token}`;
}

function rotate(keychain: string | undefined, headers: Record<string, string>): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request('http://d.test/api/config/rotate-keys', { method: 'POST', headers }),
      testEnv(keychain),
      {} as ExecutionContext,
    ),
  );
}

// Seed one Miniflux token and the YouTube refresh token under key v1.
async function seedUnderV1(): Promise<number> {
  const kc = parseKeychain(V1_ONLY);
  const mf = await encrypt('miniflux-secret', kc);
  const id = await new MinifluxInstancesRepo(db).insert({
    displayName: 'Home',
    url: 'https://home.example',
    apiTokenCt: mf.ct,
    apiTokenIv: mf.iv,
    apiTokenKv: mf.kv,
    createdAt: 1,
    updatedAt: 1,
  });
  const yt = await encrypt('youtube-secret', kc);
  await new ConfigRepo(db).setEncrypted('youtube_refresh_token', yt.ct, yt.iv, yt.kv, 1);
  await new ConfigRepo(db).setPlain('sync_log_level', 'info', 1);
  return id;
}

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('POST /api/config/rotate-keys', () => {
  it('401 without auth', async () => {
    const res = await rotate(V2_WITH_V1, {});
    expect(res.status).toBe(401);
  });

  it('re-encrypts every secret under the current key; plaintexts unchanged', async () => {
    const id = await seedUnderV1();
    const res = await rotate(V2_WITH_V1, { Cookie: await sessionCookie() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ current: 2, rotated: 2, alreadyCurrent: 0 });

    // Both rows now at v2 and decryptable with ONLY v2 — i.e. v1 can be dropped.
    const v2Only = parseKeychain(V2_ONLY);
    const inst = await new MinifluxInstancesRepo(db).get(id);
    if (!inst) throw new Error('instance missing');
    expect(inst.apiTokenKv).toBe(2);
    expect(
      await decrypt({ ct: inst.apiTokenCt, iv: inst.apiTokenIv, kv: inst.apiTokenKv }, v2Only),
    ).toBe('miniflux-secret');
    const yt = await new ConfigRepo(db).getEncrypted('youtube_refresh_token');
    if (!yt) throw new Error('youtube token missing');
    expect(yt.kv).toBe(2);
    expect(await decrypt({ ct: yt.ct, iv: yt.iv, kv: yt.kv }, v2Only)).toBe('youtube-secret');

    // Plain config rows are untouched.
    expect((await new ConfigRepo(db).getPlain('sync_log_level'))?.value).toBe('info');
  });

  it('is idempotent: a second run rotates nothing', async () => {
    await seedUnderV1();
    await rotate(V2_WITH_V1, { Cookie: await sessionCookie() });
    const res = await rotate(V2_WITH_V1, { Cookie: await sessionCookie() });
    expect(await res.json()).toEqual({ current: 2, rotated: 0, alreadyCurrent: 2 });
  });

  it('writes NOTHING when any row cannot be decrypted, and names the rows', async () => {
    const id = await seedUnderV1();
    const before = await new MinifluxInstancesRepo(db).get(id);
    // Operator dropped v1 from the keychain before rotating.
    const res = await rotate(V2_ONLY, { Cookie: await sessionCookie() });
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: string;
      failed: Array<{ table: string; id: string; kv: number }>;
    };
    expect(body.error).toBe('rotation_incomplete');
    expect(body.failed.map((f) => `${f.table}:${f.id}:v${f.kv}`).sort()).toEqual([
      'config:youtube_refresh_token:v1',
      `miniflux_instances:${id}:v1`,
    ]);
    expect(await new MinifluxInstancesRepo(db).get(id)).toEqual(before);
    expect((await new ConfigRepo(db).getEncrypted('youtube_refresh_token'))?.kv).toBe(1);
  });

  it('accepts the operator Bearer token', async () => {
    await seedUnderV1();
    const res = await rotate(V2_WITH_V1, { Authorization: `Bearer ${BEARER}` });
    expect(res.status).toBe(200);
  });

  it('500 keychain_not_configured when D1_KEYCHAIN is unset', async () => {
    const res = await rotate(undefined, { Cookie: await sessionCookie() });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('keychain_not_configured');
  });

  it('succeeds with nothing to do on an empty database', async () => {
    const res = await rotate(V2_WITH_V1, { Cookie: await sessionCookie() });
    expect(await res.json()).toEqual({ current: 2, rotated: 0, alreadyCurrent: 0 });
  });
});

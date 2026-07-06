import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { decrypt, parseKeychain } from '../../src/crypto';
import { MappingsRepo } from '../../src/repos/mappings';
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

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('GET /api/miniflux/instances', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('returns instances without leaking api_token ciphertext', async () => {
    await new MinifluxInstancesRepo(db).insert({
      displayName: 'Home',
      url: 'https://home.example',
      apiTokenCt: 'CT-SECRET',
      apiTokenIv: 'IV-SECRET',
      apiTokenKv: 1,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    });
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      instances: Array<Record<string, unknown>>;
    };
    expect(body.instances).toHaveLength(1);
    const inst = body.instances[0];
    if (!inst) throw new Error('expected one instance');
    expect(inst.displayName).toBe('Home');
    expect(inst.url).toBe('https://home.example');
    // Ciphertext should never round-trip through the API.
    expect(JSON.stringify(inst)).not.toContain('CT-SECRET');
    expect(JSON.stringify(inst)).not.toContain('IV-SECRET');
    expect(inst.apiTokenCt).toBeUndefined();
  });
});

describe('POST /api/miniflux/instances', () => {
  it('400 on invalid JSON', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances', {
        method: 'POST',
        body: 'not-json',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 on missing fields', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'x' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 on bad URL', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances', {
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Home',
          url: 'ftp://home.example',
          apiToken: 't',
        }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('500 when keychain not configured', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances', {
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Home',
          url: 'https://home.example',
          apiToken: 't',
        }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv({ D1_KEYCHAIN: undefined }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
  });

  it('encrypts the api token at rest and returns 201 without ciphertext', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances', {
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Home',
          url: 'https://home.example',
          apiToken: 'super-secret-token',
        }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBeGreaterThan(0);

    const row = await new MinifluxInstancesRepo(db).get(body.id);
    if (!row) throw new Error('inserted row missing');
    // Ciphertext should not equal plaintext.
    expect(row.apiTokenCt).not.toBe('super-secret-token');
    expect(row.apiTokenKv).toBe(1);

    // Round-trip decrypt.
    const kc = parseKeychain(TEST_KEYCHAIN_JSON);
    const decrypted = await decrypt(
      { ct: row.apiTokenCt, iv: row.apiTokenIv, kv: row.apiTokenKv },
      kc,
    );
    expect(decrypted).toBe('super-secret-token');
  });

  it('409 on duplicate URL', async () => {
    await new MinifluxInstancesRepo(db).insert({
      displayName: 'Home',
      url: 'https://home.example',
      apiTokenCt: 'ct',
      apiTokenIv: 'iv',
      apiTokenKv: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances', {
        method: 'POST',
        body: JSON.stringify({
          displayName: 'Home 2',
          url: 'https://home.example',
          apiToken: 't',
        }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/miniflux/instances/:id', () => {
  it('404 when the instance does not exist', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances/999', {
        method: 'PUT',
        body: JSON.stringify({ displayName: 'x' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('400 when no updatable fields are supplied', async () => {
    const id = await new MinifluxInstancesRepo(db).insert({
      displayName: 'Home',
      url: 'https://home.example',
      apiTokenCt: 'ct',
      apiTokenIv: 'iv',
      apiTokenKv: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/instances/${id}`, {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('re-encrypts the api token when supplied', async () => {
    const id = await new MinifluxInstancesRepo(db).insert({
      displayName: 'Home',
      url: 'https://home.example',
      apiTokenCt: 'ct',
      apiTokenIv: 'iv',
      apiTokenKv: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/instances/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ apiToken: 'rotated-token' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const row = await new MinifluxInstancesRepo(db).get(id);
    if (!row) throw new Error('row missing after update');
    expect(row.apiTokenCt).not.toBe('ct');
    const decrypted = await decrypt(
      { ct: row.apiTokenCt, iv: row.apiTokenIv, kv: row.apiTokenKv },
      parseKeychain(TEST_KEYCHAIN_JSON),
    );
    expect(decrypted).toBe('rotated-token');
  });

  it('409 on URL collision with another row', async () => {
    const idA = await new MinifluxInstancesRepo(db).insert({
      displayName: 'A',
      url: 'https://a.example',
      apiTokenCt: 'ct',
      apiTokenIv: 'iv',
      apiTokenKv: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await new MinifluxInstancesRepo(db).insert({
      displayName: 'B',
      url: 'https://b.example',
      apiTokenCt: 'ct',
      apiTokenIv: 'iv',
      apiTokenKv: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/instances/${idA}`, {
        method: 'PUT',
        body: JSON.stringify({ url: 'https://b.example' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/miniflux/instances/:id', () => {
  it('404 when the instance does not exist', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/miniflux/instances/999', {
        method: 'DELETE',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('cascades to mappings via the FK', async () => {
    const id = await new MinifluxInstancesRepo(db).insert({
      displayName: 'Home',
      url: 'https://home.example',
      apiTokenCt: 'ct',
      apiTokenIv: 'iv',
      apiTokenKv: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await new MappingsRepo(db).insert({
      minifluxInstanceId: id,
      minifluxCategory: 'Videos',
      youtubePlaylistId: 'PL-x',
      skipShorts: false,
      createdAt: 1,
      updatedAt: 1,
    });

    // vitest-pool-workers D1 sometimes disables FK by default; the schema
    // declares ON DELETE CASCADE but the pragma may need explicit enabling.
    await db.prepare('PRAGMA foreign_keys = ON').run();

    const res = await app.fetch(
      new Request(`http://d.test/api/miniflux/instances/${id}`, {
        method: 'DELETE',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const gone = await new MinifluxInstancesRepo(db).get(id);
    expect(gone).toBeNull();
    const orphans = await new MappingsRepo(db).listByInstance(id);
    expect(orphans).toEqual([]);
  });
});

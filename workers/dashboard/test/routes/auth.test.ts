import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { AdminPasskeyRepo } from '../../src/repos/admin_passkey';

const db = (env as unknown as { DB: D1Database }).DB;

const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const BEARER_TOKEN = 'super-secret-manual-trigger-token';

interface TestEnv {
  DB: D1Database;
  SESSION_SIGNING_KEY?: string;
  MANUAL_TRIGGER_TOKEN?: string;
  D1_KEYCHAIN?: string;
}

function testEnv(overrides: Partial<TestEnv> = {}): TestEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
    MANUAL_TRIGGER_TOKEN: BEARER_TOKEN,
    ...overrides,
  };
}

// D1's exec() balks at multi-line CREATE bodies; declare admin_passkey inline.
async function resetPasskeyTable(): Promise<void> {
  await db.prepare('DROP TABLE IF EXISTS admin_passkey').run();
  await db
    .prepare(
      `CREATE TABLE admin_passkey (
        credential_id      TEXT PRIMARY KEY,
        public_key         TEXT NOT NULL,
        sign_count         INTEGER NOT NULL,
        transports         TEXT,
        recovery_hash      TEXT NOT NULL,
        recovery_used_at   INTEGER,
        created_at         INTEGER NOT NULL,
        last_used_at       INTEGER
      )`,
    )
    .run();
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let s = '';
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, '0');
  return s;
}

beforeEach(async () => {
  await resetPasskeyTable();
});

describe('GET /api/me', () => {
  it('returns 401 with no auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/me'),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 with a valid session cookie', async () => {
    const token = await signSession(
      { sub: 'admin', credentialId: 'cred-abc', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/me', {
        headers: { Cookie: `fluxtube_session=${token}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { credentialId: string } };
    expect(body.session.credentialId).toBe('cred-abc');
  });

  it('returns 200 with a valid Bearer token', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/me', {
        headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { credentialId: string } };
    expect(body.session.credentialId).toBe('bearer:manual-trigger-token');
  });

  it('returns 401 on Bearer token mismatch', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/me', {
        headers: { Authorization: 'Bearer wrong' },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when session cookie is signed with a different key', async () => {
    const OTHER = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';
    const token = await signSession(
      { sub: 'admin', credentialId: 'cred-abc', issuedAt: Math.floor(Date.now() / 1000) },
      OTHER,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/me', {
        headers: { Cookie: `fluxtube_session=${token}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200 and a clearing Set-Cookie', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/logout', { method: 'POST' }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('fluxtube_session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});

describe('POST /api/auth/recovery', () => {
  const CODE = 'a1-b2-c3-d4-e5-f6-g7-h8-i9-j0-k1-l2';

  async function seedRow(): Promise<void> {
    await new AdminPasskeyRepo(db).insert({
      credentialId: 'cred-1',
      publicKey: 'pk-1',
      signCount: 0,
      transports: null,
      recoveryHash: await sha256Hex(CODE),
      createdAt: 1_700_000_000,
    });
  }

  it('400 when JSON body is malformed', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/recovery', {
        method: 'POST',
        body: 'not-json',
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 when recovery_code is missing or empty', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/recovery', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('401 when the recovery_code does not match any row', async () => {
    await seedRow();
    const res = await app.fetch(
      new Request('http://d.test/api/auth/recovery', {
        method: 'POST',
        body: JSON.stringify({ recovery_code: 'wrong-code' }),
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
    // Table intact.
    expect(await new AdminPasskeyRepo(db).count()).toBe(1);
  });

  it('200 wipes the table when the recovery_code matches', async () => {
    await seedRow();
    expect(await new AdminPasskeyRepo(db).count()).toBe(1);

    const res = await app.fetch(
      new Request('http://d.test/api/auth/recovery', {
        method: 'POST',
        body: JSON.stringify({ recovery_code: CODE }),
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wiped: number };
    expect(body.wiped).toBe(1);
    expect(await new AdminPasskeyRepo(db).count()).toBe(0);
  });
});

describe('GET /api/health (still works)', () => {
  it('returns 200 with the service name + version', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/health'),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('fluxtube-dashboard');
  });
});

// The test env in this file is a lightweight object; declare a compatible Env
// so TS is happy passing it to app.fetch.
type Env = {
  DB: D1Database;
  D1_KEYCHAIN?: string;
  SESSION_SIGNING_KEY?: string;
  MANUAL_TRIGGER_TOKEN?: string;
};

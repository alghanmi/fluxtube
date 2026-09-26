import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// Mock @simplewebauthn/server BEFORE importing anything that transitively
// pulls in the route module. Vitest hoists vi.mock() to the top of the file
// so this runs before any import of ../../src/routes/webauthn transitively.
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import app from '../../src/index';
import { challengeCookieHeader, claimCookieHeader, signChallenge } from '../../src/auth/challenge';
import { ConfigRepo } from '../../src/repos/config';
import { AdminPasskeyRepo } from '../../src/repos/admin_passkey';

const db = (env as unknown as { DB: D1Database }).DB;
const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

const OPERATOR_TOKEN = 'operator-token';
const OPERATOR_AUTH = { Authorization: `Bearer ${OPERATOR_TOKEN}` };

interface TestEnv {
  DB: D1Database;
  SESSION_SIGNING_KEY?: string;
  MANUAL_TRIGGER_TOKEN?: string;
  RP_ID?: string;
  RP_NAME?: string;
}

function testEnv(overrides: Partial<TestEnv> = {}): TestEnv {
  return {
    DB: db,
    SESSION_SIGNING_KEY: HMAC_KEY,
    MANUAL_TRIGGER_TOKEN: OPERATOR_TOKEN,
    RP_ID: 'fluxtube.test.example',
    ...overrides,
  };
}

async function resetPasskeyTable(): Promise<void> {
  await db.prepare('DROP TABLE IF EXISTS config').run();
  await db
    .prepare(
      `CREATE TABLE config (
        key TEXT PRIMARY KEY, value TEXT, value_ct TEXT, value_iv TEXT,
        value_kv INTEGER, updated_at INTEGER NOT NULL
      )`,
    )
    .run();
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

async function seedPasskey(
  overrides: Partial<Parameters<AdminPasskeyRepo['insert']>[0]> = {},
): Promise<void> {
  await new AdminPasskeyRepo(db).insert({
    credentialId: 'cred-abc',
    publicKey: 'AAECAw', // base64url, arbitrary
    signCount: 3,
    transports: null,
    recoveryHash: 'hash',
    createdAt: 1_700_000_000,
    ...overrides,
  });
}

beforeEach(async () => {
  await resetPasskeyTable();
  vi.mocked(generateRegistrationOptions).mockReset();
  vi.mocked(generateAuthenticationOptions).mockReset();
  vi.mocked(verifyRegistrationResponse).mockReset();
  vi.mocked(verifyAuthenticationResponse).mockReset();
});

describe('POST /api/auth/passkey/register/begin', () => {
  it('500 when RP_ID is not configured', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', { method: 'POST' }),
      testEnv({ RP_ID: undefined }) as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('rp_id_not_configured');
  });

  it('500 when SESSION_SIGNING_KEY is not configured', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', { method: 'POST' }),
      testEnv({ SESSION_SIGNING_KEY: undefined }) as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(500);
  });

  it('409 when admin_passkey already has a row', async () => {
    await seedPasskey();
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', { method: 'POST' }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
  });

  it('401 on an empty table without operator token or claim ticket', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', { method: 'POST' }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('claim_not_authorized');
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it('401 with a wrong operator token', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', {
        method: 'POST',
        headers: { Authorization: 'Bearer nope' },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('accepts a valid claim ticket cookie in place of the operator token', async () => {
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'gen-challenge-abc',
    } as unknown as Awaited<ReturnType<typeof generateRegistrationOptions>>);
    const ticket = await signChallenge(
      { purpose: 'claim', value: 'nonce', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const cookie = claimCookieHeader(ticket).split(';')[0] ?? '';
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', {
        method: 'POST',
        headers: { Cookie: cookie },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });

  it('rejects an expired claim ticket', async () => {
    const ticket = await signChallenge(
      { purpose: 'claim', value: 'nonce', issuedAt: Math.floor(Date.now() / 1000) - 16 * 60 },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', {
        method: 'POST',
        headers: { Cookie: claimCookieHeader(ticket).split(';')[0] ?? '' },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('does not accept a WebAuthn challenge cookie as a claim ticket', async () => {
    const challenge = await signChallenge(
      { purpose: 'register', value: 'c', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', {
        method: 'POST',
        // Same token presented under the claim cookie name.
        headers: { Cookie: `fluxtube_claim=${challenge}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('200 returns options + sets challenge cookie when table is empty', async () => {
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'gen-challenge-abc',
      rp: { name: 'FluxTube', id: 'fluxtube.test.example' },
      user: { id: 'u', name: 'admin', displayName: 'admin' },
      pubKeyCredParams: [],
      timeout: 60000,
      attestation: 'none',
    } as unknown as Awaited<ReturnType<typeof generateRegistrationOptions>>);

    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/begin', {
        method: 'POST',
        headers: OPERATOR_AUTH,
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge).toBe('gen-challenge-abc');

    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('fluxtube_challenge=');
    expect(setCookie).toContain('Path=/api/auth/passkey');
    expect(setCookie).toContain('Max-Age=300');
  });
});

describe('POST /api/auth/passkey/register/finish', () => {
  it('400 when challenge cookie is missing', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/finish', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('challenge_missing_or_expired');
  });

  it('409 when admin_passkey grew between begin and finish', async () => {
    await seedPasskey();
    const challengeToken = await signChallenge(
      { purpose: 'register', value: 'gen-challenge-abc', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/finish', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { Cookie: `fluxtube_challenge=${challengeToken}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
  });

  it('400 when JSON body is malformed', async () => {
    const challengeToken = await signChallenge(
      { purpose: 'register', value: 'gen-challenge-abc', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/finish', {
        method: 'POST',
        body: 'not-json',
        headers: { Cookie: `fluxtube_challenge=${challengeToken}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_json');
  });

  it('400 when verifyRegistrationResponse throws', async () => {
    (verifyRegistrationResponse as unknown as Mock).mockRejectedValue(
      new Error('boom: authenticator sig invalid'),
    );
    const challengeToken = await signChallenge(
      { purpose: 'register', value: 'gen-challenge-abc', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/finish', {
        method: 'POST',
        body: JSON.stringify({ id: 'x', rawId: 'x', response: {}, type: 'public-key' }),
        headers: { Cookie: `fluxtube_challenge=${challengeToken}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('registration_verification_failed');
  });

  it('200 inserts credential + returns recovery code + sets session cookie on success', async () => {
    // publicKey is a plain Uint8Array here; verifyRegistrationResponse's real
    // return type has a more specific TypedArray shape but the code path only
    // uses .length + iteration, both of which work on plain Uint8Array.
    (verifyRegistrationResponse as unknown as Mock).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'new-cred-id',
          publicKey: new Uint8Array([1, 2, 3, 4, 5]),
          counter: 0,
        },
        credentialBackedUp: true,
      },
    });
    const challengeToken = await signChallenge(
      { purpose: 'register', value: 'gen-challenge-abc', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/register/finish', {
        method: 'POST',
        body: JSON.stringify({
          id: 'new-cred-id',
          rawId: 'new-cred-id',
          response: { transports: ['internal'] },
          type: 'public-key',
        }),
        headers: { Cookie: `fluxtube_challenge=${challengeToken}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      credentialId: string;
      recoveryCode: string;
      credentialBackedUp: boolean;
    };
    expect(body.credentialId).toBe('new-cred-id');
    expect(body.recoveryCode).toBeTypeOf('string');
    expect(body.recoveryCode.length).toBeGreaterThan(30);
    expect(body.credentialBackedUp).toBe(true);

    // Two SEPARATE Set-Cookie headers. res.headers.get('Set-Cookie') only
    // returns the first; use getSetCookie() to see both. Joining them with
    // ", " into a single header would silently break — cookie values contain
    // commas (Expires=Wed, ...), so the browser reads the joined header as
    // ONE cookie and only honors the first one.
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(
      cookies.some((c) => c.startsWith('fluxtube_challenge=') && c.includes('Max-Age=0')),
    ).toBe(true);
    // The claim ticket (if any) is spent once a passkey exists.
    expect(cookies.some((c) => c.startsWith('fluxtube_claim=') && c.includes('Max-Age=0'))).toBe(
      true,
    );
    expect(cookies.some((c) => c.startsWith('fluxtube_session=') && c.includes('Max-Age='))).toBe(
      true,
    );

    // Row landed in D1.
    const row = await new AdminPasskeyRepo(db).get('new-cred-id');
    expect(row).not.toBeNull();
    expect(row?.signCount).toBe(0);
    expect(row?.transports).toEqual(['internal']);
    // Recovery code hash stored, not the plaintext.
    expect(row?.recoveryHash).toHaveLength(64); // sha256 hex
    expect(row?.recoveryHash).not.toBe(body.recoveryCode);

    // Durable D1-managed flag, so a later recovery wipe can't flip the sync
    // Worker back to env-binding config.
    expect((await new ConfigRepo(db).getPlain('config_mode'))?.value).toBe('d1');
  });
});

describe('POST /api/auth/passkey/authenticate/begin', () => {
  it('404 when no passkey is registered', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/authenticate/begin', { method: 'POST' }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('no_registered_passkey');
  });

  it('200 returns options + challenge cookie when a passkey exists', async () => {
    await seedPasskey();
    (generateAuthenticationOptions as unknown as Mock).mockResolvedValue({
      challenge: 'auth-challenge-xyz',
      timeout: 60000,
      rpId: 'fluxtube.test.example',
      allowCredentials: [{ id: 'cred-abc', type: 'public-key' }],
    });

    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/authenticate/begin', { method: 'POST' }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { challenge: string }).challenge).toBe('auth-challenge-xyz');
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('fluxtube_challenge=');
  });
});

describe('POST /api/auth/passkey/authenticate/finish', () => {
  it('400 when challenge cookie is missing', async () => {
    await seedPasskey();
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/authenticate/finish', {
        method: 'POST',
        body: JSON.stringify({ id: 'cred-abc' }),
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('404 when credential id is unknown', async () => {
    // No passkey seeded.
    const challengeToken = await signChallenge(
      { purpose: 'authenticate', value: 'x', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/authenticate/finish', {
        method: 'POST',
        body: JSON.stringify({ id: 'ghost', rawId: 'ghost', response: {}, type: 'public-key' }),
        headers: { Cookie: `fluxtube_challenge=${challengeToken}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('200 bumps sign_count + sets session cookie on verified assertion', async () => {
    await seedPasskey({ signCount: 5 });
    (verifyAuthenticationResponse as unknown as Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    const challengeToken = await signChallenge(
      { purpose: 'authenticate', value: 'x', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/authenticate/finish', {
        method: 'POST',
        body: JSON.stringify({
          id: 'cred-abc',
          rawId: 'cred-abc',
          response: {},
          type: 'public-key',
        }),
        headers: { Cookie: `fluxtube_challenge=${challengeToken}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { credentialId: string }).credentialId).toBe('cred-abc');

    // Two separate Set-Cookie headers — see register/finish for why.
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.some((c) => c.startsWith('fluxtube_session='))).toBe(true);
    expect(
      cookies.some((c) => c.startsWith('fluxtube_challenge=') && c.includes('Max-Age=0')),
    ).toBe(true);

    // sign_count bumped in D1.
    const row = await new AdminPasskeyRepo(db).get('cred-abc');
    expect(row?.signCount).toBe(6);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('400 when verifyAuthenticationResponse returns unverified', async () => {
    await seedPasskey();
    (verifyAuthenticationResponse as unknown as Mock).mockResolvedValue({
      verified: false,
      authenticationInfo: { newCounter: 0 },
    });
    const challengeToken = await signChallenge(
      { purpose: 'authenticate', value: 'x', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/authenticate/finish', {
        method: 'POST',
        body: JSON.stringify({
          id: 'cred-abc',
          rawId: 'cred-abc',
          response: {},
          type: 'public-key',
        }),
        headers: { Cookie: `fluxtube_challenge=${challengeToken}` },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('authentication_not_verified');
  });
});

describe('challenge cookie signing (integration)', () => {
  it('accepts a challenge signed with challengeCookieHeader shape', async () => {
    // Sanity check that our helper produces a cookie the route parses.
    await seedPasskey();
    const token = await signChallenge(
      { purpose: 'authenticate', value: 'x', issuedAt: Math.floor(Date.now() / 1000) },
      HMAC_KEY,
    );
    const cookie = challengeCookieHeader(token).split(';')[0];
    if (!cookie) throw new Error('challengeCookieHeader produced empty output');
    (verifyAuthenticationResponse as unknown as Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 42 },
    });
    const res = await app.fetch(
      new Request('http://d.test/api/auth/passkey/authenticate/finish', {
        method: 'POST',
        body: JSON.stringify({
          id: 'cred-abc',
          rawId: 'cred-abc',
          response: {},
          type: 'public-key',
        }),
        headers: { Cookie: cookie },
      }),
      testEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });
});

// The test env in this file is a lightweight object; declare a compatible
// Env so TS is happy passing it to app.fetch.
type Env = {
  DB: D1Database;
  SESSION_SIGNING_KEY?: string;
  RP_ID?: string;
  RP_NAME?: string;
};

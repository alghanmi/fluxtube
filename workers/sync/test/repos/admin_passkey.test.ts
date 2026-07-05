import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminPasskeyRepo } from '../../src/repos/admin_passkey';
import { resetV1Schema } from '../testdb';

const db = (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await resetV1Schema(db);
});

const seed = (overrides: Partial<Parameters<AdminPasskeyRepo['insert']>[0]> = {}) => ({
  credentialId: 'cred-abc',
  publicKey: 'pk-base64',
  signCount: 0,
  transports: ['internal', 'hybrid'],
  recoveryHash: 'sha256-hex-of-recovery-code',
  createdAt: 1700000000,
  ...overrides,
});

describe('AdminPasskeyRepo', () => {
  it('count() is the D1-managed-mode gate', async () => {
    const repo = new AdminPasskeyRepo(db);
    expect(await repo.count()).toBe(0);

    await repo.insert(seed());
    expect(await repo.count()).toBe(1);
  });

  it('insert + get roundtrip; transports is round-tripped as a string[] via JSON', async () => {
    const repo = new AdminPasskeyRepo(db);
    await repo.insert(seed());

    const row = await repo.get('cred-abc');
    expect(row).toEqual({
      credentialId: 'cred-abc',
      publicKey: 'pk-base64',
      signCount: 0,
      transports: ['internal', 'hybrid'],
      recoveryHash: 'sha256-hex-of-recovery-code',
      recoveryUsedAt: null,
      createdAt: 1700000000,
      lastUsedAt: null,
    });
  });

  it('insert allows null transports', async () => {
    const repo = new AdminPasskeyRepo(db);
    await repo.insert(seed({ transports: null }));
    const row = await repo.get('cred-abc');
    expect(row?.transports).toBeNull();
  });

  it('listAll returns rows in created_at order', async () => {
    const repo = new AdminPasskeyRepo(db);
    await repo.insert(seed({ credentialId: 'first', createdAt: 1 }));
    await repo.insert(seed({ credentialId: 'second', createdAt: 2 }));
    const all = await repo.listAll();
    expect(all.map((r) => r.credentialId)).toEqual(['first', 'second']);
  });

  it('updateSignCount bumps sign_count and last_used_at', async () => {
    const repo = new AdminPasskeyRepo(db);
    await repo.insert(seed());
    await repo.updateSignCount('cred-abc', 42, 1700000999);
    const row = await repo.get('cred-abc');
    expect(row).toMatchObject({ signCount: 42, lastUsedAt: 1700000999 });
  });

  it('deleteAllMatching wipes iff the hash matches ANY row', async () => {
    const repo = new AdminPasskeyRepo(db);
    await repo.insert(seed({ credentialId: 'cred-a', recoveryHash: 'hash-shared' }));
    await repo.insert(seed({ credentialId: 'cred-b', recoveryHash: 'hash-shared' }));

    const affected = await repo.deleteAllMatching('hash-shared', 1700000999);
    expect(affected).toBe(2);
    expect(await repo.count()).toBe(0);
  });

  it('deleteAllMatching returns 0 and leaves table intact when hash does NOT match', async () => {
    const repo = new AdminPasskeyRepo(db);
    await repo.insert(seed({ credentialId: 'cred-a', recoveryHash: 'hash-actual' }));

    const affected = await repo.deleteAllMatching('hash-wrong', 1700000999);
    expect(affected).toBe(0);
    expect(await repo.count()).toBe(1);
    const row = await repo.get('cred-a');
    expect(row?.recoveryUsedAt).toBeNull(); // audit stamp NOT applied
  });
});

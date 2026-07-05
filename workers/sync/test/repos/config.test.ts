import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRepo } from '../../src/repos/config';
import { resetV1Schema } from '../testdb';

const db = (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('ConfigRepo', () => {
  it('plain: setPlain + getPlain roundtrip', async () => {
    const repo = new ConfigRepo(db);
    await repo.setPlain('sync_log_level', 'debug', 1700000000);

    const row = await repo.getPlain('sync_log_level');
    expect(row).toEqual({ key: 'sync_log_level', value: 'debug', updatedAt: 1700000000 });

    // The encrypted-shape getter returns null for a plain row.
    expect(await repo.getEncrypted('sync_log_level')).toBeNull();
  });

  it('encrypted: setEncrypted + getEncrypted roundtrip', async () => {
    const repo = new ConfigRepo(db);
    await repo.setEncrypted('youtube_refresh_token', 'ct-base64', 'iv-base64', 3, 1700000000);

    const row = await repo.getEncrypted('youtube_refresh_token');
    expect(row).toEqual({
      key: 'youtube_refresh_token',
      ct: 'ct-base64',
      iv: 'iv-base64',
      kv: 3,
      updatedAt: 1700000000,
    });

    // The plain-shape getter returns null for an encrypted row.
    expect(await repo.getPlain('youtube_refresh_token')).toBeNull();
  });

  it('setPlain overwrites an encrypted row and nulls the ct/iv/kv triple', async () => {
    const repo = new ConfigRepo(db);
    await repo.setEncrypted('flag', 'ct', 'iv', 1, 1700000000);
    expect(await repo.getEncrypted('flag')).not.toBeNull();

    await repo.setPlain('flag', 'plaintext-now', 1700000100);
    expect(await repo.getEncrypted('flag')).toBeNull();
    expect(await repo.getPlain('flag')).toMatchObject({ value: 'plaintext-now' });
  });

  it('setEncrypted overwrites a plain row and nulls value', async () => {
    const repo = new ConfigRepo(db);
    await repo.setPlain('flag', 'plaintext', 1700000000);
    expect(await repo.getPlain('flag')).not.toBeNull();

    await repo.setEncrypted('flag', 'ct2', 'iv2', 2, 1700000100);
    expect(await repo.getPlain('flag')).toBeNull();
    expect(await repo.getEncrypted('flag')).toMatchObject({ ct: 'ct2', kv: 2 });
  });

  it('has() reflects existence regardless of shape', async () => {
    const repo = new ConfigRepo(db);
    expect(await repo.has('nope')).toBe(false);
    await repo.setPlain('nope', 'x', 1700000000);
    expect(await repo.has('nope')).toBe(true);
  });

  it('delete removes the row', async () => {
    const repo = new ConfigRepo(db);
    await repo.setPlain('flag', 'x', 1700000000);
    await repo.delete('flag');
    expect(await repo.has('flag')).toBe(false);
  });

  it('CHECK rejects a raw insert with both value and value_ct set', async () => {
    // Direct raw insert bypassing the repo, to prove the schema constraint fires.
    await expect(
      db
        .prepare(
          `INSERT INTO config (key, value, value_ct, value_iv, value_kv, updated_at)
           VALUES ('bad', 'v', 'ct', 'iv', 1, 1)`,
        )
        .run(),
    ).rejects.toThrow();
  });

  it('CHECK rejects a raw insert with neither value nor value_ct set', async () => {
    await expect(
      db
        .prepare(
          `INSERT INTO config (key, value, value_ct, value_iv, value_kv, updated_at)
           VALUES ('bad', NULL, NULL, NULL, NULL, 1)`,
        )
        .run(),
    ).rejects.toThrow();
  });
});

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MinifluxInstancesRepo } from '../../src/repos/miniflux_instances';
import { resetV1Schema } from '../testdb';

const db = (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await resetV1Schema(db);
});

// The api_token_* triple is passed through as opaque values — the repo
// doesn't touch encryption. Phase 2's crypto util does that upstream.
const seed = (overrides: Partial<Parameters<MinifluxInstancesRepo['insert']>[0]> = {}) => ({
  displayName: 'Home',
  url: 'https://reader.example.com',
  apiTokenCt: 'ct-base64',
  apiTokenIv: 'iv-base64',
  apiTokenKv: 1,
  createdAt: 1700000000,
  updatedAt: 1700000000,
  ...overrides,
});

describe('MinifluxInstancesRepo', () => {
  it('insert + get roundtrip preserves all columns', async () => {
    const repo = new MinifluxInstancesRepo(db);
    const id = await repo.insert(seed());
    const row = await repo.get(id);
    expect(row).toEqual({
      id,
      displayName: 'Home',
      url: 'https://reader.example.com',
      apiTokenCt: 'ct-base64',
      apiTokenIv: 'iv-base64',
      apiTokenKv: 1,
      createdAt: 1700000000,
      updatedAt: 1700000000,
    });
  });

  it('list returns rows ordered by id ascending', async () => {
    const repo = new MinifluxInstancesRepo(db);
    await repo.insert(seed({ url: 'https://a.example.com' }));
    await repo.insert(seed({ url: 'https://b.example.com' }));
    await repo.insert(seed({ url: 'https://c.example.com' }));

    const list = await repo.list();
    expect(list.map((r) => r.url)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]);
  });

  it('getByUrl looks up by url', async () => {
    const repo = new MinifluxInstancesRepo(db);
    const id = await repo.insert(seed({ url: 'https://reader.example.com' }));

    const found = await repo.getByUrl('https://reader.example.com');
    expect(found?.id).toBe(id);

    const missing = await repo.getByUrl('https://nope.example.com');
    expect(missing).toBeNull();
  });

  it('UNIQUE(url) rejects duplicates', async () => {
    const repo = new MinifluxInstancesRepo(db);
    await repo.insert(seed({ url: 'https://reader.example.com' }));
    await expect(
      repo.insert(seed({ url: 'https://reader.example.com', displayName: 'Home v2' })),
    ).rejects.toThrow();
  });

  it('update patches partial fields and updates updated_at', async () => {
    const repo = new MinifluxInstancesRepo(db);
    const id = await repo.insert(seed());

    await repo.update(id, { displayName: 'Home renamed', updatedAt: 1700000999 });
    const patched = await repo.get(id);
    expect(patched?.displayName).toBe('Home renamed');
    expect(patched?.url).toBe('https://reader.example.com'); // untouched
    expect(patched?.updatedAt).toBe(1700000999);
  });

  it('update rotates the (ct, iv, kv) triple together', async () => {
    const repo = new MinifluxInstancesRepo(db);
    const id = await repo.insert(seed());

    await repo.update(id, {
      apiTokenCt: 'new-ct',
      apiTokenIv: 'new-iv',
      apiTokenKv: 2,
      updatedAt: 1700001000,
    });
    const rotated = await repo.get(id);
    expect(rotated).toMatchObject({ apiTokenCt: 'new-ct', apiTokenIv: 'new-iv', apiTokenKv: 2 });
  });

  it('delete removes the row', async () => {
    const repo = new MinifluxInstancesRepo(db);
    const id = await repo.insert(seed());
    await repo.delete(id);
    expect(await repo.get(id)).toBeNull();
  });
});

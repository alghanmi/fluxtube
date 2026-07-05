import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MappingsRepo } from '../../src/repos/mappings';
import { MinifluxInstancesRepo } from '../../src/repos/miniflux_instances';
import { resetV1Schema } from '../testdb';

const db = (env as unknown as { DB: D1Database }).DB;

async function seedInstance(url: string): Promise<number> {
  return new MinifluxInstancesRepo(db).insert({
    displayName: url,
    url,
    apiTokenCt: 'ct',
    apiTokenIv: 'iv',
    apiTokenKv: 1,
    createdAt: 1700000000,
    updatedAt: 1700000000,
  });
}

const mapping = (
  instanceId: number,
  category: string,
  playlist: string,
  skipShorts = false,
) => ({
  minifluxInstanceId: instanceId,
  minifluxCategory: category,
  youtubePlaylistId: playlist,
  skipShorts,
  createdAt: 1700000000,
  updatedAt: 1700000000,
});

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('MappingsRepo', () => {
  it('insert + list roundtrip; skip_shorts is stored as bool', async () => {
    const repo = new MappingsRepo(db);
    const instanceId = await seedInstance('https://a.example.com');

    await repo.insert(mapping(instanceId, 'tech', 'PL_tech', true));
    await repo.insert(mapping(instanceId, 'music', 'PL_music', false));

    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ minifluxCategory: 'tech', skipShorts: true });
    expect(list[1]).toMatchObject({ minifluxCategory: 'music', skipShorts: false });
  });

  it('listByInstance filters correctly', async () => {
    const repo = new MappingsRepo(db);
    const a = await seedInstance('https://a.example.com');
    const b = await seedInstance('https://b.example.com');

    await repo.insert(mapping(a, 'tech', 'PL_a_tech'));
    await repo.insert(mapping(a, 'music', 'PL_a_music'));
    await repo.insert(mapping(b, 'tech', 'PL_b_tech'));

    const rowsA = await repo.listByInstance(a);
    expect(rowsA.map((r) => r.youtubePlaylistId)).toEqual(['PL_a_tech', 'PL_a_music']);
    const rowsB = await repo.listByInstance(b);
    expect(rowsB.map((r) => r.youtubePlaylistId)).toEqual(['PL_b_tech']);
  });

  it('UNIQUE(instance, category, playlist) rejects duplicates', async () => {
    const repo = new MappingsRepo(db);
    const a = await seedInstance('https://a.example.com');
    await repo.insert(mapping(a, 'tech', 'PL_tech'));
    await expect(repo.insert(mapping(a, 'tech', 'PL_tech'))).rejects.toThrow();
  });

  it('same (category, playlist) allowed across DIFFERENT instances', async () => {
    const repo = new MappingsRepo(db);
    const a = await seedInstance('https://a.example.com');
    const b = await seedInstance('https://b.example.com');
    await repo.insert(mapping(a, 'tech', 'PL_tech'));
    await expect(repo.insert(mapping(b, 'tech', 'PL_tech'))).resolves.toBeTypeOf('number');
  });

  it('deleting the instance cascades and removes its mappings (FK)', async () => {
    const instancesRepo = new MinifluxInstancesRepo(db);
    const mappingsRepo = new MappingsRepo(db);
    const a = await seedInstance('https://a.example.com');
    const b = await seedInstance('https://b.example.com');

    await mappingsRepo.insert(mapping(a, 'tech', 'PL_a_tech'));
    await mappingsRepo.insert(mapping(b, 'tech', 'PL_b_tech'));

    await instancesRepo.delete(a);

    const remaining = await mappingsRepo.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.minifluxInstanceId).toBe(b);
  });

  it('replaceForInstance clears + rewrites atomically, leaves other instance untouched', async () => {
    const repo = new MappingsRepo(db);
    const a = await seedInstance('https://a.example.com');
    const b = await seedInstance('https://b.example.com');

    await repo.insert(mapping(a, 'old-tech', 'PL_old_tech'));
    await repo.insert(mapping(b, 'unrelated', 'PL_b'));

    const newIds = await repo.replaceForInstance(a, [
      mapping(a, 'new-tech', 'PL_new_tech'),
      mapping(a, 'new-music', 'PL_new_music'),
    ]);

    expect(newIds).toHaveLength(2);
    const rowsA = await repo.listByInstance(a);
    expect(rowsA.map((r) => r.minifluxCategory)).toEqual(['new-tech', 'new-music']);
    const rowsB = await repo.listByInstance(b);
    expect(rowsB.map((r) => r.youtubePlaylistId)).toEqual(['PL_b']);
  });
});

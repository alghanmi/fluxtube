import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MappingHistoryRepo } from '../../src/repos/mapping_history';
import { resetV1Schema } from '../testdb';

const db = (env as unknown as { DB: D1Database }).DB;

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('MappingHistoryRepo', () => {
  it('append + get roundtrip preserves actor + snapshot', async () => {
    const repo = new MappingHistoryRepo(db);
    const id = await repo.append({
      snapshotJson: JSON.stringify({ mappings: [] }),
      actor: 'ui',
      createdAt: 1700000000,
    });
    const row = await repo.get(id);
    expect(row).toEqual({
      id,
      snapshotJson: '{"mappings":[]}',
      actor: 'ui',
      createdAt: 1700000000,
    });
  });

  it('listLatest returns rows newest-first up to the limit', async () => {
    const repo = new MappingHistoryRepo(db);
    await repo.append({ snapshotJson: '"first"', actor: 'ui', createdAt: 1700000000 });
    await repo.append({ snapshotJson: '"second"', actor: 'ui', createdAt: 1700000100 });
    await repo.append({ snapshotJson: '"third"', actor: 'ui', createdAt: 1700000200 });

    const latest = await repo.listLatest(2);
    expect(latest.map((r) => r.snapshotJson)).toEqual(['"third"', '"second"']);
  });

  it('pruneToLatestN keeps the newest N and drops the rest', async () => {
    const repo = new MappingHistoryRepo(db);
    for (let i = 0; i < 15; i++) {
      await repo.append({
        snapshotJson: `${i}`,
        actor: 'ui',
        createdAt: 1700000000 + i * 10,
      });
    }
    await repo.pruneToLatestN(10);

    const remaining = await repo.listLatest(100);
    expect(remaining).toHaveLength(10);
    // Newest first: created_at 1700000140 down to 1700000050.
    expect(remaining[0]?.snapshotJson).toBe('14');
    expect(remaining[9]?.snapshotJson).toBe('5');
  });

  it('accepts each documented actor', async () => {
    const repo = new MappingHistoryRepo(db);
    await repo.append({ snapshotJson: 'a', actor: 'ui', createdAt: 1 });
    await repo.append({ snapshotJson: 'b', actor: 'restore', createdAt: 2 });
    await repo.append({ snapshotJson: 'c', actor: 'migration', createdAt: 3 });
    const all = await repo.listLatest(10);
    expect(all.map((r) => r.actor)).toEqual(['migration', 'restore', 'ui']);
  });
});

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index';
import { signSession } from '../../src/auth/session';
import { ConfigRepo } from '../../src/repos/config';
import { MappingHistoryRepo } from '../../src/repos/mapping_history';
import { MappingsRepo } from '../../src/repos/mappings';
import { MinifluxInstancesRepo } from '../../src/repos/miniflux_instances';
import { resetV1Schema, TEST_KEYCHAIN_JSON } from '../support/schema';

const db = (env as unknown as { DB: D1Database }).DB;

const HMAC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

interface TestEnv {
  DB: D1Database;
  SESSION_SIGNING_KEY?: string;
  MANUAL_TRIGGER_TOKEN?: string;
  D1_KEYCHAIN?: string;
}
type AppEnv = Parameters<typeof app.fetch>[1];

function testEnv(overrides: Partial<TestEnv> = {}): AppEnv {
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

async function seedInstance(url: string): Promise<number> {
  return await new MinifluxInstancesRepo(db).insert({
    displayName: `Instance for ${url}`,
    url,
    apiTokenCt: 'ct',
    apiTokenIv: 'iv',
    apiTokenKv: 1,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
}

async function seedMapping(
  instanceId: number,
  category: string,
  playlist: string,
): Promise<number> {
  return await new MappingsRepo(db).insert({
    minifluxInstanceId: instanceId,
    minifluxCategory: category,
    youtubePlaylistId: playlist,
    skipShorts: false,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
}

beforeEach(async () => {
  await resetV1Schema(db);
});

describe('GET /api/mappings', () => {
  it('401 with no auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('returns empty instances array when nothing is seeded', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings', { headers: { Cookie: await sessionCookie() } }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { instances: unknown[] };
    expect(body.instances).toEqual([]);
  });

  it('returns instances grouped with their mappings', async () => {
    const id1 = await seedInstance('https://home.example');
    const id2 = await seedInstance('https://work.example');
    await seedMapping(id1, 'Videos', 'PL-a');
    await seedMapping(id1, 'Talks', 'PL-b');
    await seedMapping(id2, 'Videos', 'PL-c');

    const res = await app.fetch(
      new Request('http://d.test/api/mappings', { headers: { Cookie: await sessionCookie() } }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      instances: Array<{
        id: number;
        displayName: string;
        mappings: Array<{ minifluxCategory: string; youtubePlaylistId: string }>;
      }>;
    };
    expect(body.instances).toHaveLength(2);
    const home = body.instances.find((i) => i.id === id1);
    expect(home?.mappings.map((m) => m.minifluxCategory).sort()).toEqual(['Talks', 'Videos']);
    const work = body.instances.find((i) => i.id === id2);
    expect(work?.mappings).toHaveLength(1);
    expect(work?.mappings[0]?.youtubePlaylistId).toBe('PL-c');
  });
});

describe('PUT /api/mappings', () => {
  it('400 on invalid JSON', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings', {
        method: 'PUT',
        body: 'not-json',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('400 when mappings is not an array', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings', {
        method: 'PUT',
        body: JSON.stringify({ mappings: 'nope' }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('409 when a mapping references a non-existent instance', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings', {
        method: 'PUT',
        body: JSON.stringify({
          mappings: [
            {
              minifluxInstanceId: 999,
              minifluxCategory: 'Videos',
              youtubePlaylistId: 'PL-x',
              skipShorts: false,
            },
          ],
        }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(409);
  });

  it('replaces mappings for the referenced instance and preserves untouched instances', async () => {
    const id1 = await seedInstance('https://home.example');
    const id2 = await seedInstance('https://work.example');
    await seedMapping(id1, 'Old', 'PL-old');
    await seedMapping(id2, 'Keep', 'PL-keep');

    const res = await app.fetch(
      new Request('http://d.test/api/mappings', {
        method: 'PUT',
        body: JSON.stringify({
          mappings: [
            {
              minifluxInstanceId: id1,
              minifluxCategory: 'New',
              youtubePlaylistId: 'PL-new',
              skipShorts: true,
            },
          ],
        }),
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);

    const home = (await new MappingsRepo(db).listByInstance(id1));
    expect(home).toHaveLength(1);
    expect(home[0]?.minifluxCategory).toBe('New');
    expect(home[0]?.skipShorts).toBe(true);

    const work = await new MappingsRepo(db).listByInstance(id2);
    expect(work).toHaveLength(1);
    expect(work[0]?.minifluxCategory).toBe('Keep');
  });

  it('writes a history snapshot before mutating and prunes to history_window', async () => {
    const id1 = await seedInstance('https://home.example');
    await seedMapping(id1, 'Videos', 'PL-a');

    // history_window = 2 so we can prove pruning happens
    await new ConfigRepo(db).setPlain('history_window', '2', 1_700_000_000);

    const putBody = JSON.stringify({
      mappings: [
        {
          minifluxInstanceId: id1,
          minifluxCategory: 'Videos',
          youtubePlaylistId: 'PL-a',
          skipShorts: false,
        },
      ],
    });

    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(
        new Request('http://d.test/api/mappings', {
          method: 'PUT',
          body: putBody,
          headers: { Cookie: await sessionCookie() },
        }),
        testEnv(),
        {} as ExecutionContext,
      );
      expect(res.status).toBe(200);
    }

    const rows = await new MappingHistoryRepo(db).listLatest(10);
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.actor).toBe('ui');
  });
});

describe('GET /api/mappings/history', () => {
  it('401 without auth', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings/history'),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('returns rows with parsed snapshot payloads', async () => {
    const id1 = await seedInstance('https://home.example');
    await seedMapping(id1, 'Videos', 'PL-a');
    const snapshot = JSON.stringify({
      instances: [{ id: id1, displayName: 'Home', url: 'https://home.example' }],
      mappings: [
        {
          minifluxInstanceId: id1,
          minifluxCategory: 'Videos',
          youtubePlaylistId: 'PL-a',
          skipShorts: false,
        },
      ],
    });
    await new MappingHistoryRepo(db).append({
      snapshotJson: snapshot,
      actor: 'ui',
      createdAt: 1_700_000_100,
    });

    const res = await app.fetch(
      new Request('http://d.test/api/mappings/history', {
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      history: Array<{
        actor: string;
        snapshot: { mappings: Array<{ youtubePlaylistId: string }> };
      }>;
    };
    expect(body.history).toHaveLength(1);
    expect(body.history[0]?.actor).toBe('ui');
    expect(body.history[0]?.snapshot.mappings[0]?.youtubePlaylistId).toBe('PL-a');
  });
});

describe('POST /api/mappings/history/:id/restore', () => {
  it('404 when the history id is unknown', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings/history/9999/restore', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });

  it('400 on non-integer history id', async () => {
    const res = await app.fetch(
      new Request('http://d.test/api/mappings/history/abc/restore', {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });

  it('restores mappings from the snapshot and reports skipped instances', async () => {
    const id1 = await seedInstance('https://home.example');
    const missingInstanceId = 42; // deliberately not seeded

    const snapshotJson = JSON.stringify({
      instances: [
        { id: id1, displayName: 'Home', url: 'https://home.example' },
        {
          id: missingInstanceId,
          displayName: 'Gone',
          url: 'https://gone.example',
        },
      ],
      mappings: [
        {
          minifluxInstanceId: id1,
          minifluxCategory: 'Videos',
          youtubePlaylistId: 'PL-old',
          skipShorts: false,
        },
        {
          minifluxInstanceId: id1,
          minifluxCategory: 'Talks',
          youtubePlaylistId: 'PL-old-2',
          skipShorts: true,
        },
        {
          minifluxInstanceId: missingInstanceId,
          minifluxCategory: 'Videos',
          youtubePlaylistId: 'PL-orphan',
          skipShorts: false,
        },
      ],
    });
    const histId = await new MappingHistoryRepo(db).append({
      snapshotJson,
      actor: 'ui',
      createdAt: 1_700_000_050,
    });

    // Give the current state some rows that will get replaced.
    await seedMapping(id1, 'Current', 'PL-current');

    const res = await app.fetch(
      new Request(`http://d.test/api/mappings/history/${histId}/restore`, {
        method: 'POST',
        headers: { Cookie: await sessionCookie() },
      }),
      testEnv(),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      restoredFromHistoryId: number;
      skipped: Array<{ minifluxInstanceId: number; count: number }>;
    };
    expect(body.restoredFromHistoryId).toBe(histId);
    expect(body.skipped).toEqual([{ minifluxInstanceId: missingInstanceId, count: 1 }]);

    const home = await new MappingsRepo(db).listByInstance(id1);
    expect(home.map((m) => m.minifluxCategory).sort()).toEqual(['Talks', 'Videos']);

    // A restore also snapshots — so history should contain the pre-restore
    // state under actor='restore'.
    const historyRows = await new MappingHistoryRepo(db).listLatest(10);
    expect(historyRows.some((r) => r.actor === 'restore')).toBe(true);
  });
});

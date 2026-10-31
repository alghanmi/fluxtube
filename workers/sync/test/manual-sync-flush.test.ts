import { env as testEnv } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { resetV1Schema } from './testdb';

// POST /sync returns 202 and runs the sync inside ctx.waitUntil. Its
// manual_sync_complete line and fluxtube.runs point are produced after the
// response, so they must be flushed when that background run settles, not
// only when the fetch handler returns.

const db = (testEnv as unknown as { DB: D1Database }).DB;
const TOKEN = 'trigger-token';
const LOKI = 'https://loki.example.test';
const OTLP = 'https://otlp.example.test/otlp';
const MINIFLUX = 'https://miniflux.example.test';

const QUEUE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS queue (
    miniflux_entry_id   INTEGER NOT NULL,
    youtube_video_id    TEXT    NOT NULL,
    youtube_playlist_id TEXT    NOT NULL,
    playlist_item_id    TEXT    NOT NULL,
    added_at            INTEGER NOT NULL,
    PRIMARY KEY (miniflux_entry_id, youtube_playlist_id)
  )`,
];

function envManaged(): Env {
  return {
    DB: db,
    MINIFLUX_URL: MINIFLUX,
    MINIFLUX_API_TOKEN: 'mf-token',
    CATEGORY_PLAYLIST_MAPPING: '[{"category":"Videos","playlist_id":"PLaaaaaaaaaaaaaaaa"}]',
    YOUTUBE_CLIENT_ID: 'yt-cid',
    YOUTUBE_CLIENT_SECRET: 'yt-cs',
    YOUTUBE_REFRESH_TOKEN: 'yt-rt',
    MANUAL_TRIGGER_TOKEN: TOKEN,
    SYNC_LOG_LEVEL: 'info',
    INSTANCE_ID: 'test',
    GRAFANA_LOKI_URL: LOKI,
    GRAFANA_LOKI_USER: 'loki-user',
    GRAFANA_LOKI_TOKEN: 'loki-token',
    GRAFANA_OTLP_URL: OTLP,
    GRAFANA_OTLP_USER: 'otlp-user',
    GRAFANA_OTLP_TOKEN: 'otlp-token',
  };
}

// Collects every waitUntil promise, including ones registered while the
// earlier ones are still running, so the test can wait for all of them.
function collectingCtx(): ExecutionContext & { drain: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
    drain: async () => {
      let seen = 0;
      while (seen < pending.length) {
        const batch = pending.slice(seen);
        seen = pending.length;
        await Promise.allSettled(batch);
      }
    },
  } as unknown as ExecutionContext & { drain: () => Promise<void> };
}

const later = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 5));

interface Pushed {
  lokiEvents: string[];
  otlpMetricNames: string[];
}

function stubNetwork(opts: { minifluxFails?: boolean } = {}): Pushed {
  const pushed: Pushed = { lokiEvents: [], otlpMetricNames: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === LOKI) {
        const body = JSON.parse(String(init?.body)) as {
          streams: Array<{ values: Array<[string, string]> }>;
        };
        for (const s of body.streams) {
          for (const [, line] of s.values) {
            pushed.lokiEvents.push((JSON.parse(line) as { event: string }).event);
          }
        }
        return new Response(null, { status: 204 });
      }
      if (url.origin === new URL(OTLP).origin) {
        const body = JSON.parse(String(init?.body)) as {
          resourceMetrics: Array<{ scopeMetrics: Array<{ metrics: Array<{ name: string }> }> }>;
        };
        for (const rm of body.resourceMetrics) {
          for (const sm of rm.scopeMetrics) {
            for (const m of sm.metrics) pushed.otlpMetricNames.push(m.name);
          }
        }
        return new Response('{}', { status: 200 });
      }
      // Miniflux answers after a macrotask, so the background run settles
      // strictly after the 202 has been returned.
      if (url.origin === MINIFLUX && opts.minifluxFails) {
        return later(new Response('boom', { status: 502 }));
      }
      if (url.origin === MINIFLUX && url.pathname === '/v1/categories') {
        return later(Response.json([{ id: 1, title: 'Videos' }]));
      }
      if (url.origin === MINIFLUX && url.pathname === '/v1/entries') {
        return later(Response.json({ total: 0, entries: [] }));
      }
      if (url.href === 'https://oauth2.googleapis.com/token') {
        return later(Response.json({ access_token: 'at', expires_in: 3600, token_type: 'Bearer' }));
      }
      if (url.origin === 'https://www.googleapis.com' && url.pathname.endsWith('/playlistItems')) {
        return later(Response.json({ items: [] }));
      }
      throw new Error(`unexpected fetch in test: ${url.href}`);
    }),
  );
  return pushed;
}

beforeEach(async () => {
  await resetV1Schema(db);
  await db.prepare('DROP TABLE IF EXISTS queue').run();
  for (const stmt of QUEUE_SCHEMA) await db.prepare(stmt).run();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /sync (background) ships its logs and metrics', () => {
  it('flushes manual_sync_complete and one fluxtube.runs point after the run settles', async () => {
    const pushed = stubNetwork();
    const ctx = collectingCtx();

    const res = await worker.fetch(
      new Request('https://sync.test/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      envManaged(),
      ctx,
    );
    expect(res.status).toBe(202);

    await ctx.drain();

    expect(pushed.lokiEvents).toContain('manual_sync_triggered');
    expect(pushed.lokiEvents).toContain('manual_sync_complete');
    expect(pushed.otlpMetricNames.filter((n) => n === 'fluxtube.runs')).toHaveLength(1);
  });

  it('flushes manual_sync_failed and one fluxtube.runs point when the run fails', async () => {
    const pushed = stubNetwork({ minifluxFails: true });
    const ctx = collectingCtx();

    const res = await worker.fetch(
      new Request('https://sync.test/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      envManaged(),
      ctx,
    );
    expect(res.status).toBe(202);

    await ctx.drain();

    expect(pushed.lokiEvents).toContain('manual_sync_failed');
    expect(pushed.otlpMetricNames.filter((n) => n === 'fluxtube.runs')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../src/index';

describe('dashboard worker — Phase 0 health probe', () => {
  it('GET /api/health returns ok + version', async () => {
    const res = await app.fetch(
      new Request('http://dashboard.test/api/health'),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('fluxtube-dashboard');
    expect(typeof body.version).toBe('string');
  });

  it('unknown route returns 404', async () => {
    const res = await app.fetch(
      new Request('http://dashboard.test/api/nope'),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });
});

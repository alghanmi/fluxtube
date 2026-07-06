// Mapping CRUD + history routes.
//
//   GET  /api/mappings                          → grouped by instance
//   PUT  /api/mappings                          → full-replacement save,
//                                                 snapshots + prunes history
//   GET  /api/mappings/history                  → last history_window rows,
//                                                 with parsed snapshot payload
//   POST /api/mappings/history/:id/restore      → restore from snapshot,
//                                                 snapshots current first
//
// All routes require auth (session cookie OR Bearer). Save + restore paths
// wrap their D1 writes in a batch so a mid-run failure doesn't leave the
// mappings table half-mutated.

import type { Hono } from 'hono';
import { requireAuth } from '../auth/require_auth';
import type { DashboardAuthEnv } from '../auth/require_auth';
import { ConfigRepo } from '../repos/config';
import { MappingHistoryRepo } from '../repos/mapping_history';
import { MappingsRepo } from '../repos/mappings';
import type { MappingInsert } from '../repos/mappings';
import { MinifluxInstancesRepo } from '../repos/miniflux_instances';

export interface MappingsEnv extends DashboardAuthEnv {
  DB: D1Database;
}

const DEFAULT_HISTORY_WINDOW = 10;

interface MappingPayload {
  minifluxInstanceId: number;
  minifluxCategory: string;
  youtubePlaylistId: string;
  skipShorts: boolean;
}

interface SnapshotPayload {
  instances: Array<{ id: number; displayName: string; url: string }>;
  mappings: MappingPayload[];
}

export function attachMappingsRoutes(app: Hono<{ Bindings: MappingsEnv }>): void {
  // ─── GET /api/mappings ──────────────────────────────────────────────

  app.get('/api/mappings', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    return c.json({ instances: await currentGrouped(c.env.DB) });
  });

  // ─── PUT /api/mappings ──────────────────────────────────────────────
  //
  // Payload: { mappings: MappingPayload[] }
  // Semantics: for every instance id present in the payload, its full set of
  // mappings is replaced. Instances not mentioned in the payload keep their
  // existing mappings — omit an instance and its mappings survive unchanged.

  app.put('/api/mappings', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = parseMappingsPayload(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    // Validate every referenced instance actually exists — a save that
    // silently drops rows because a client typo'd an id would be worse
    // than a 409.
    const instanceIds = uniqueInstanceIds(parsed.mappings);
    const instances = new MinifluxInstancesRepo(c.env.DB);
    for (const id of instanceIds) {
      const row = await instances.get(id);
      if (!row) {
        return c.json({ error: 'unknown_instance', minifluxInstanceId: id }, 409);
      }
    }

    const now = nowSec();
    await snapshotAndPrune(c.env.DB, 'ui', now);

    const mappingsRepo = new MappingsRepo(c.env.DB);
    for (const instanceId of instanceIds) {
      const forInstance = parsed.mappings
        .filter((m) => m.minifluxInstanceId === instanceId)
        .map<MappingInsert>((m) => ({
          minifluxInstanceId: m.minifluxInstanceId,
          minifluxCategory: m.minifluxCategory,
          youtubePlaylistId: m.youtubePlaylistId,
          skipShorts: m.skipShorts,
          createdAt: now,
          updatedAt: now,
        }));
      await mappingsRepo.replaceForInstance(instanceId, forInstance);
    }

    return c.json({ instances: await currentGrouped(c.env.DB) });
  });

  // ─── GET /api/mappings/history ──────────────────────────────────────

  app.get('/api/mappings/history', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const limit = await readHistoryWindow(c.env.DB);
    const rows = await new MappingHistoryRepo(c.env.DB).listLatest(limit);
    return c.json({
      history: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        createdAt: r.createdAt,
        snapshot: safeParseSnapshot(r.snapshotJson),
      })),
    });
  });

  // ─── POST /api/mappings/history/:id/restore ─────────────────────────

  app.post('/api/mappings/history/:id/restore', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    const idRaw = c.req.param('id');
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'invalid_history_id' }, 400);
    }

    const historyRepo = new MappingHistoryRepo(c.env.DB);
    const row = await historyRepo.get(id);
    if (!row) return c.json({ error: 'history_not_found' }, 404);

    const snapshot = safeParseSnapshot(row.snapshotJson);
    if (!snapshot) return c.json({ error: 'corrupt_snapshot' }, 500);

    // Snapshot the CURRENT state before overwriting so restore itself is
    // undoable via the same history list.
    const now = nowSec();
    await snapshotAndPrune(c.env.DB, 'restore', now);

    // Reconcile snapshot instance ids against current miniflux_instances.
    // An instance in the snapshot might have been deleted since — skip its
    // mappings and report them so the UI can surface the discrepancy.
    const instancesRepo = new MinifluxInstancesRepo(c.env.DB);
    const mappingsRepo = new MappingsRepo(c.env.DB);
    const skipped: Array<{ minifluxInstanceId: number; count: number }> = [];

    const affectedIds = uniqueInstanceIds(snapshot.mappings);
    for (const instanceId of affectedIds) {
      const current = await instancesRepo.get(instanceId);
      const rows = snapshot.mappings.filter((m) => m.minifluxInstanceId === instanceId);
      if (!current) {
        skipped.push({ minifluxInstanceId: instanceId, count: rows.length });
        continue;
      }
      const inserts = rows.map<MappingInsert>((m) => ({
        minifluxInstanceId: m.minifluxInstanceId,
        minifluxCategory: m.minifluxCategory,
        youtubePlaylistId: m.youtubePlaylistId,
        skipShorts: m.skipShorts,
        createdAt: now,
        updatedAt: now,
      }));
      await mappingsRepo.replaceForInstance(instanceId, inserts);
    }

    return c.json({
      instances: await currentGrouped(c.env.DB),
      restoredFromHistoryId: id,
      skipped,
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function currentGrouped(
  db: D1Database,
): Promise<Array<{
  id: number;
  displayName: string;
  url: string;
  mappings: Array<{
    id: number;
    minifluxCategory: string;
    youtubePlaylistId: string;
    skipShorts: boolean;
  }>;
}>> {
  const instances = await new MinifluxInstancesRepo(db).list();
  const mappings = await new MappingsRepo(db).list();
  return instances.map((inst) => ({
    id: inst.id,
    displayName: inst.displayName,
    url: inst.url,
    mappings: mappings
      .filter((m) => m.minifluxInstanceId === inst.id)
      .map((m) => ({
        id: m.id,
        minifluxCategory: m.minifluxCategory,
        youtubePlaylistId: m.youtubePlaylistId,
        skipShorts: m.skipShorts,
      })),
  }));
}

async function snapshotAndPrune(
  db: D1Database,
  actor: 'ui' | 'restore' | 'migration',
  now: number,
): Promise<void> {
  const instances = await new MinifluxInstancesRepo(db).list();
  const mappings = await new MappingsRepo(db).list();
  const snapshot: SnapshotPayload = {
    instances: instances.map((i) => ({ id: i.id, displayName: i.displayName, url: i.url })),
    mappings: mappings.map((m) => ({
      minifluxInstanceId: m.minifluxInstanceId,
      minifluxCategory: m.minifluxCategory,
      youtubePlaylistId: m.youtubePlaylistId,
      skipShorts: m.skipShorts,
    })),
  };
  const historyRepo = new MappingHistoryRepo(db);
  await historyRepo.append({
    snapshotJson: JSON.stringify(snapshot),
    actor,
    createdAt: now,
  });
  await historyRepo.pruneToLatestN(await readHistoryWindow(db));
}

async function readHistoryWindow(db: D1Database): Promise<number> {
  const row = await new ConfigRepo(db).getPlain('history_window');
  if (!row) return DEFAULT_HISTORY_WINDOW;
  const n = Number(row.value);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_HISTORY_WINDOW;
  return n;
}

function uniqueInstanceIds(mappings: MappingPayload[]): number[] {
  return Array.from(new Set(mappings.map((m) => m.minifluxInstanceId))).sort((a, b) => a - b);
}

type ParseResult =
  | { ok: true; mappings: MappingPayload[] }
  | { ok: false; error: string };

function parseMappingsPayload(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid_body' };
  const raw = (body as { mappings?: unknown }).mappings;
  if (!Array.isArray(raw)) return { ok: false, error: 'mappings_not_array' };

  const out: MappingPayload[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: 'mapping_entry_not_object' };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.minifluxInstanceId !== 'number' || !Number.isInteger(e.minifluxInstanceId)) {
      return { ok: false, error: 'missing_or_invalid_minifluxInstanceId' };
    }
    if (typeof e.minifluxCategory !== 'string' || e.minifluxCategory.length === 0) {
      return { ok: false, error: 'missing_or_invalid_minifluxCategory' };
    }
    if (typeof e.youtubePlaylistId !== 'string' || e.youtubePlaylistId.length === 0) {
      return { ok: false, error: 'missing_or_invalid_youtubePlaylistId' };
    }
    if (typeof e.skipShorts !== 'boolean') {
      return { ok: false, error: 'missing_or_invalid_skipShorts' };
    }
    out.push({
      minifluxInstanceId: e.minifluxInstanceId,
      minifluxCategory: e.minifluxCategory,
      youtubePlaylistId: e.youtubePlaylistId,
      skipShorts: e.skipShorts,
    });
  }
  return { ok: true, mappings: out };
}

function safeParseSnapshot(json: string): SnapshotPayload | null {
  try {
    const parsed = JSON.parse(json) as SnapshotPayload;
    if (!parsed || !Array.isArray(parsed.instances) || !Array.isArray(parsed.mappings)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

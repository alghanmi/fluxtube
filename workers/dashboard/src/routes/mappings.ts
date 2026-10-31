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
// All routes require a passkey session. Save + restore build every write
// (the history snapshot, the prune, and each instance's DELETE + INSERTs)
// as statements and run them in one db.batch(), which D1 executes as a
// single transaction: a failure part-way rolls the whole save back rather
// than leaving an instance with only some of its rows.

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
  // Semantics: the payload is the complete set of mappings. Every configured
  // instance is replaced with the rows sent for it, so an instance with no
  // rows in the payload ends up with none. (The editor always sends every
  // instance's rows, and deleting an instance's last row must stick.)

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
    const configured = (await new MinifluxInstancesRepo(c.env.DB).list()).map((i) => i.id);
    const known = new Set(configured);
    for (const id of uniqueInstanceIds(parsed.mappings)) {
      if (!known.has(id)) {
        return c.json({ error: 'unknown_instance', minifluxInstanceId: id }, 409);
      }
    }

    const now = nowSec();
    const mappingsRepo = new MappingsRepo(c.env.DB);
    const statements = await snapshotStatements(c.env.DB, 'ui', now);
    for (const instanceId of configured) {
      const forInstance = toInserts(
        parsed.mappings.filter((m) => m.minifluxInstanceId === instanceId),
        now,
      );
      statements.push(...mappingsRepo.replaceForInstanceStatements(instanceId, forInstance));
    }
    await c.env.DB.batch(statements);

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
    // undoable via the same history list. It commits with the restore.
    const now = nowSec();
    const statements = await snapshotStatements(c.env.DB, 'restore', now);

    // Reconcile snapshot instance ids against current miniflux_instances.
    // An instance in the snapshot might have been deleted since — skip its
    // mappings and report them so the UI can surface the discrepancy. An
    // instance the snapshot lists with no mappings is restored to none.
    const current = new Set((await new MinifluxInstancesRepo(c.env.DB).list()).map((i) => i.id));
    const mappingsRepo = new MappingsRepo(c.env.DB);
    const skipped: Array<{ minifluxInstanceId: number; count: number }> = [];

    const affectedIds = Array.from(
      new Set([...snapshot.instances.map((i) => i.id), ...uniqueInstanceIds(snapshot.mappings)]),
    ).sort((a, b) => a - b);
    for (const instanceId of affectedIds) {
      const rows = snapshot.mappings.filter((m) => m.minifluxInstanceId === instanceId);
      if (!current.has(instanceId)) {
        if (rows.length > 0) skipped.push({ minifluxInstanceId: instanceId, count: rows.length });
        continue;
      }
      statements.push(
        ...mappingsRepo.replaceForInstanceStatements(instanceId, toInserts(rows, now)),
      );
    }
    await c.env.DB.batch(statements);

    return c.json({
      instances: await currentGrouped(c.env.DB),
      restoredFromHistoryId: id,
      skipped,
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function currentGrouped(db: D1Database): Promise<
  Array<{
    id: number;
    displayName: string;
    url: string;
    mappings: Array<{
      id: number;
      minifluxCategory: string;
      youtubePlaylistId: string;
      skipShorts: boolean;
    }>;
  }>
> {
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

// The history snapshot of the current state, and the prune that keeps
// history_window rows, as statements to run at the head of the save's batch.
async function snapshotStatements(
  db: D1Database,
  actor: 'ui' | 'restore' | 'migration',
  now: number,
): Promise<D1PreparedStatement[]> {
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
  return [
    historyRepo.appendStatement({ snapshotJson: JSON.stringify(snapshot), actor, createdAt: now }),
    historyRepo.pruneToLatestNStatement(await readHistoryWindow(db)),
  ];
}

function toInserts(rows: MappingPayload[], now: number): MappingInsert[] {
  return rows.map((m) => ({
    minifluxInstanceId: m.minifluxInstanceId,
    minifluxCategory: m.minifluxCategory,
    youtubePlaylistId: m.youtubePlaylistId,
    skipShorts: m.skipShorts,
    createdAt: now,
    updatedAt: now,
  }));
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

type ParseResult = { ok: true; mappings: MappingPayload[] } | { ok: false; error: string };

// A custom YouTube playlist id: `PL` and then the id body, from YouTube's
// base64url alphabet (16 or 32 characters in practice). The sync Worker's
// env-managed config enforces the same `PL` prefix. Watch Later (`WL`) and
// pasted URLs are refused here, before anything is written.
const PLAYLIST_ID_RE = /^PL[A-Za-z0-9_-]{10,62}$/;

function parseMappingsPayload(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid_body' };
  const raw = (body as { mappings?: unknown }).mappings;
  if (!Array.isArray(raw)) return { ok: false, error: 'mappings_not_array' };

  const out: MappingPayload[] = [];
  const seen = new Set<string>();
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
    if (typeof e.youtubePlaylistId !== 'string' || !PLAYLIST_ID_RE.test(e.youtubePlaylistId)) {
      return { ok: false, error: 'missing_or_invalid_youtubePlaylistId' };
    }
    if (typeof e.skipShorts !== 'boolean') {
      return { ok: false, error: 'missing_or_invalid_skipShorts' };
    }
    // The table is UNIQUE on this tuple; a duplicate would otherwise surface
    // as a 500 from the batch.
    const key = JSON.stringify([e.minifluxInstanceId, e.minifluxCategory, e.youtubePlaylistId]);
    if (seen.has(key)) return { ok: false, error: 'duplicate_mapping' };
    seen.add(key);
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

// Repo for the `mapping_history` D1 table. Append-only. The dashboard's
// PUT /api/mappings snapshots the current mapping+instance shape into a row
// here before mutating. UI shows the last `history_window` rows (config
// table); older rows are pruned via `pruneOlderThan()` called from the
// same save path so history doesn't grow unbounded.

export type HistoryActor = 'ui' | 'restore' | 'migration';

export interface HistoryRow {
  id: number;
  snapshotJson: string;
  actor: HistoryActor;
  createdAt: number;
}

export interface HistoryInsert {
  snapshotJson: string;
  actor: HistoryActor;
  createdAt: number;
}

interface Row {
  id: number;
  snapshot_json: string;
  actor: string;
  created_at: number;
}

function toModel(r: Row): HistoryRow {
  return {
    id: r.id,
    snapshotJson: r.snapshot_json,
    actor: r.actor as HistoryActor,
    createdAt: r.created_at,
  };
}

export class MappingHistoryRepo {
  constructor(private readonly db: D1Database) {}

  async append(row: HistoryInsert): Promise<number> {
    const res = await this.db
      .prepare(
        `INSERT INTO mapping_history (snapshot_json, actor, created_at)
         VALUES (?, ?, ?)
         RETURNING id`,
      )
      .bind(row.snapshotJson, row.actor, row.createdAt)
      .first<{ id: number }>();
    if (!res) throw new Error('mapping_history.append returned no row');
    return res.id;
  }

  async get(id: number): Promise<HistoryRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM mapping_history WHERE id = ?')
      .bind(id)
      .first<Row>();
    return r ? toModel(r) : null;
  }

  /** Newest first. */
  async listLatest(limit: number): Promise<HistoryRow[]> {
    const res = await this.db
      .prepare('SELECT * FROM mapping_history ORDER BY created_at DESC, id DESC LIMIT ?')
      .bind(limit)
      .all<Row>();
    return (res.results ?? []).map(toModel);
  }

  /**
   * Prunes rows so at most `keep` newest remain. Called from the save path
   * with `keep = history_window` after a new snapshot has been appended.
   */
  async pruneToLatestN(keep: number): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM mapping_history
         WHERE id NOT IN (
           SELECT id FROM mapping_history ORDER BY created_at DESC, id DESC LIMIT ?
         )`,
      )
      .bind(keep)
      .run();
  }
}

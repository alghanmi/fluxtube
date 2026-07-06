// Repo for the `mappings` D1 table. Replaces the v0 CATEGORY_PLAYLIST_MAPPING
// env-var JSON payload once the sync worker enters D1-managed mode (Phase 3).

export interface MappingRow {
  id: number;
  minifluxInstanceId: number;
  minifluxCategory: string;
  youtubePlaylistId: string;
  skipShorts: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MappingInsert {
  minifluxInstanceId: number;
  minifluxCategory: string;
  youtubePlaylistId: string;
  skipShorts: boolean;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: number;
  miniflux_instance_id: number;
  miniflux_category: string;
  youtube_playlist_id: string;
  skip_shorts: number;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): MappingRow {
  return {
    id: r.id,
    minifluxInstanceId: r.miniflux_instance_id,
    minifluxCategory: r.miniflux_category,
    youtubePlaylistId: r.youtube_playlist_id,
    skipShorts: r.skip_shorts === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class MappingsRepo {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<MappingRow[]> {
    const res = await this.db.prepare('SELECT * FROM mappings ORDER BY id ASC').all<Row>();
    return (res.results ?? []).map(toModel);
  }

  async listByInstance(minifluxInstanceId: number): Promise<MappingRow[]> {
    const res = await this.db
      .prepare('SELECT * FROM mappings WHERE miniflux_instance_id = ? ORDER BY id ASC')
      .bind(minifluxInstanceId)
      .all<Row>();
    return (res.results ?? []).map(toModel);
  }

  /** Returns the new row's id. Throws on UNIQUE collision. */
  async insert(row: MappingInsert): Promise<number> {
    const res = await this.db
      .prepare(
        `INSERT INTO mappings
           (miniflux_instance_id, miniflux_category, youtube_playlist_id, skip_shorts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        row.minifluxInstanceId,
        row.minifluxCategory,
        row.youtubePlaylistId,
        row.skipShorts ? 1 : 0,
        row.createdAt,
        row.updatedAt,
      )
      .first<{ id: number }>();
    if (!res) throw new Error('mappings.insert returned no row');
    return res.id;
  }

  async delete(id: number): Promise<void> {
    await this.db.prepare('DELETE FROM mappings WHERE id = ?').bind(id).run();
  }

  /**
   * Full-replacement save for a single Miniflux instance. Used by the
   * dashboard's PUT /api/mappings when the user hits "Save" — the caller
   * wraps this + a mapping_history snapshot in one D1 batch/transaction.
   * Returns the ids of the newly-inserted rows.
   */
  async replaceForInstance(
    minifluxInstanceId: number,
    rows: MappingInsert[],
  ): Promise<number[]> {
    await this.db
      .prepare('DELETE FROM mappings WHERE miniflux_instance_id = ?')
      .bind(minifluxInstanceId)
      .run();
    const ids: number[] = [];
    for (const row of rows) {
      ids.push(await this.insert(row));
    }
    return ids;
  }
}

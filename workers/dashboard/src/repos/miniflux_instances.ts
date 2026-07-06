// Repo for the `miniflux_instances` D1 table. Owns nothing about encryption
// itself — the api_token_ct/_iv/_kv triple is passed through as opaque base64
// + integer. Phase 2's crypto util handles encrypt/decrypt at the API layer.
//
// snake_case in SQL, camelCase in TS.

export interface MinifluxInstanceRow {
  id: number;
  displayName: string;
  url: string;
  apiTokenCt: string;
  apiTokenIv: string;
  apiTokenKv: number;
  createdAt: number;
  updatedAt: number;
}

export interface MinifluxInstanceInsert {
  displayName: string;
  url: string;
  apiTokenCt: string;
  apiTokenIv: string;
  apiTokenKv: number;
  createdAt: number;
  updatedAt: number;
}

/** Partial update — only the fields present are written. */
export interface MinifluxInstanceUpdate {
  displayName?: string;
  url?: string;
  apiTokenCt?: string;
  apiTokenIv?: string;
  apiTokenKv?: number;
  updatedAt: number;
}

interface Row {
  id: number;
  display_name: string;
  url: string;
  api_token_ct: string;
  api_token_iv: string;
  api_token_kv: number;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): MinifluxInstanceRow {
  return {
    id: r.id,
    displayName: r.display_name,
    url: r.url,
    apiTokenCt: r.api_token_ct,
    apiTokenIv: r.api_token_iv,
    apiTokenKv: r.api_token_kv,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class MinifluxInstancesRepo {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<MinifluxInstanceRow[]> {
    const res = await this.db
      .prepare('SELECT * FROM miniflux_instances ORDER BY id ASC')
      .all<Row>();
    return (res.results ?? []).map(toModel);
  }

  async get(id: number): Promise<MinifluxInstanceRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM miniflux_instances WHERE id = ?')
      .bind(id)
      .first<Row>();
    return r ? toModel(r) : null;
  }

  async getByUrl(url: string): Promise<MinifluxInstanceRow | null> {
    const r = await this.db
      .prepare('SELECT * FROM miniflux_instances WHERE url = ?')
      .bind(url)
      .first<Row>();
    return r ? toModel(r) : null;
  }

  /** Returns the new row's id. Throws on UNIQUE(url) collision. */
  async insert(row: MinifluxInstanceInsert): Promise<number> {
    const res = await this.db
      .prepare(
        `INSERT INTO miniflux_instances
           (display_name, url, api_token_ct, api_token_iv, api_token_kv, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        row.displayName,
        row.url,
        row.apiTokenCt,
        row.apiTokenIv,
        row.apiTokenKv,
        row.createdAt,
        row.updatedAt,
      )
      .first<{ id: number }>();
    if (!res) throw new Error('miniflux_instances.insert returned no row');
    return res.id;
  }

  async update(id: number, patch: MinifluxInstanceUpdate): Promise<void> {
    const sets: string[] = [];
    const binds: (string | number)[] = [];
    if (patch.displayName !== undefined) {
      sets.push('display_name = ?');
      binds.push(patch.displayName);
    }
    if (patch.url !== undefined) {
      sets.push('url = ?');
      binds.push(patch.url);
    }
    if (patch.apiTokenCt !== undefined) {
      sets.push('api_token_ct = ?');
      binds.push(patch.apiTokenCt);
    }
    if (patch.apiTokenIv !== undefined) {
      sets.push('api_token_iv = ?');
      binds.push(patch.apiTokenIv);
    }
    if (patch.apiTokenKv !== undefined) {
      sets.push('api_token_kv = ?');
      binds.push(patch.apiTokenKv);
    }
    sets.push('updated_at = ?');
    binds.push(patch.updatedAt);
    binds.push(id);

    await this.db
      .prepare(`UPDATE miniflux_instances SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  }

  /** Cascades to `mappings` via the FK ON DELETE CASCADE. */
  async delete(id: number): Promise<void> {
    await this.db.prepare('DELETE FROM miniflux_instances WHERE id = ?').bind(id).run();
  }
}

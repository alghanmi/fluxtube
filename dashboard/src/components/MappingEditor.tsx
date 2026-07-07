// Mapping editor — per-instance cards showing category → playlist rows.
//
// Fetches on mount:
//   * grouped mappings (/api/mappings)
//   * live Miniflux categories per instance
//   * YouTube playlists (once — cached across instances)
//
// Add / remove / edit rows in place. A floating Save button flushes to
// PUT /api/mappings; a toast reports the outcome. Dirty state is tracked so
// the button dims when the local state matches the server.

import { useEffect, useMemo, useState } from 'preact/hooks';
import * as api from '../lib/api';

interface Row {
  key: string; // stable client-side id
  minifluxCategory: string;
  youtubePlaylistId: string;
  skipShorts: boolean;
}

interface Group {
  instanceId: number;
  displayName: string;
  url: string;
  rows: Row[];
  categoriesLoaded: 'idle' | 'loading' | 'loaded' | 'error';
  categories: api.MinifluxCategory[];
  categoriesError: string | null;
}

type Toast =
  | { kind: 'ok'; message: string }
  | { kind: 'err'; message: string }
  | null;

let clientKeyCounter = 0;
function nextKey(): string {
  clientKeyCounter += 1;
  return `k-${clientKeyCounter}-${Date.now()}`;
}

export function MappingEditor(): preact.JSX.Element {
  const [groups, setGroups] = useState<Group[]>([]);
  const [playlists, setPlaylists] = useState<api.YouTubePlaylist[]>([]);
  const [ytConnected, setYtConnected] = useState<boolean | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [initial, setInitial] = useState<string>('[]');

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const instances = await api.getMappings();
      const next: Group[] = instances.map((i) => ({
        instanceId: i.id,
        displayName: i.displayName,
        url: i.url,
        rows: i.mappings.map((m) => ({
          key: nextKey(),
          minifluxCategory: m.minifluxCategory,
          youtubePlaylistId: m.youtubePlaylistId,
          skipShorts: m.skipShorts,
        })),
        categoriesLoaded: 'idle',
        categories: [],
        categoriesError: null,
      }));
      setGroups(next);
      setInitial(serialize(next));
      // Kick off async fetches for the deps.
      void refreshPlaylists();
      for (const g of next) void loadCategories(g.instanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshPlaylists(): Promise<void> {
    try {
      const items = await api.listPlaylists();
      setPlaylists(items);
      setYtConnected(true);
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 409) {
        setYtConnected(false);
      } else {
        setYtError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function loadCategories(instanceId: number): Promise<void> {
    setGroups((prev) =>
      prev.map((g) => (g.instanceId === instanceId ? { ...g, categoriesLoaded: 'loading' } : g)),
    );
    try {
      const cats = await api.listCategories(instanceId);
      setGroups((prev) =>
        prev.map((g) =>
          g.instanceId === instanceId
            ? { ...g, categoriesLoaded: 'loaded', categories: cats, categoriesError: null }
            : g,
        ),
      );
    } catch (err) {
      setGroups((prev) =>
        prev.map((g) =>
          g.instanceId === instanceId
            ? {
                ...g,
                categoriesLoaded: 'error',
                categoriesError: err instanceof Error ? err.message : String(err),
              }
            : g,
        ),
      );
    }
  }

  function addRow(instanceId: number): void {
    setGroups((prev) =>
      prev.map((g) =>
        g.instanceId === instanceId
          ? {
              ...g,
              rows: [
                ...g.rows,
                { key: nextKey(), minifluxCategory: '', youtubePlaylistId: '', skipShorts: false },
              ],
            }
          : g,
      ),
    );
  }

  function updateRow(instanceId: number, key: string, patch: Partial<Row>): void {
    setGroups((prev) =>
      prev.map((g) =>
        g.instanceId === instanceId
          ? { ...g, rows: g.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }
          : g,
      ),
    );
  }

  function removeRow(instanceId: number, key: string): void {
    setGroups((prev) =>
      prev.map((g) =>
        g.instanceId === instanceId
          ? { ...g, rows: g.rows.filter((r) => r.key !== key) }
          : g,
      ),
    );
  }

  const dirty = useMemo(() => serialize(groups) !== initial, [groups, initial]);

  async function onSave(): Promise<void> {
    if (!dirty || saving) return;
    setSaving(true);
    setToast(null);
    try {
      const payload: api.MappingPayload[] = [];
      for (const g of groups) {
        for (const r of g.rows) {
          if (!r.minifluxCategory || !r.youtubePlaylistId) continue;
          payload.push({
            minifluxInstanceId: g.instanceId,
            minifluxCategory: r.minifluxCategory,
            youtubePlaylistId: r.youtubePlaylistId,
            skipShorts: r.skipShorts,
          });
        }
      }
      await api.saveMappings(payload);
      await bootstrap(); // rehydrate from server (cleans up empty rows, gets fresh IDs)
      setToast({ kind: 'ok', message: 'Saved' });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p class="muted">Loading mappings…</p>;
  if (error) return <div class="terminal" style="border-color: var(--color-danger);">{error}</div>;

  return (
    <div class="stack">
      {ytConnected === false && (
        <div class="card" style="border-color: var(--color-amber);">
          <h2 class="card-title">YouTube not connected</h2>
          <p class="card-subtitle">
            Connect a YouTube account so the sync worker can add videos to your playlists.
          </p>
          <a href={api.youtubeOAuthBeginUrl()} class="button primary">
            Connect YouTube
          </a>
        </div>
      )}
      {ytError && (
        <div class="terminal" style="border-color: var(--color-danger);">
          Couldn't list YouTube playlists: {ytError}
        </div>
      )}

      {groups.length === 0 && (
        <div class="card">
          <h2 class="card-title">No Miniflux instances yet</h2>
          <p class="card-subtitle">
            Add one from the settings page, then come back here to map categories to playlists.
          </p>
          <a href="/dashboard/settings" class="button primary">
            Go to settings
          </a>
        </div>
      )}

      {groups.map((g) => (
        <InstanceCard
          key={g.instanceId}
          group={g}
          playlists={playlists}
          onAdd={() => addRow(g.instanceId)}
          onChange={(key, patch) => updateRow(g.instanceId, key, patch)}
          onRemove={(key) => removeRow(g.instanceId, key)}
          onReloadCategories={() => void loadCategories(g.instanceId)}
        />
      ))}

      {groups.length > 0 && (
        <div class="row" style="margin-top: var(--space-6);">
          <button class="primary" disabled={!dirty || saving} onClick={onSave}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
          {dirty && <span class="muted xs">Unsaved changes</span>}
        </div>
      )}

      {toast && <div class={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}

function InstanceCard(props: {
  group: Group;
  playlists: api.YouTubePlaylist[];
  onAdd: () => void;
  onChange: (key: string, patch: Partial<Row>) => void;
  onRemove: (key: string) => void;
  onReloadCategories: () => void;
}): preact.JSX.Element {
  const { group, playlists, onAdd, onChange, onRemove, onReloadCategories } = props;
  return (
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <h2 class="card-title">{group.displayName}</h2>
          <p class="card-subtitle muted xs">{group.url}</p>
        </div>
        {group.categoriesLoaded === 'error' && (
          <button onClick={onReloadCategories}>Retry categories</button>
        )}
      </div>

      {group.categoriesError && (
        <div class="terminal" style="border-color: var(--color-danger);">
          Miniflux categories fetch failed: {group.categoriesError}
        </div>
      )}

      {group.rows.length === 0 && (
        <p class="muted xs" style="margin: var(--space-2) 0;">
          No mappings yet. Add one below.
        </p>
      )}

      <div class="stack">
        {group.rows.map((r) => (
          <MappingRow
            key={r.key}
            row={r}
            categories={group.categories}
            playlists={playlists}
            categoriesLoaded={group.categoriesLoaded}
            onChange={(patch) => onChange(r.key, patch)}
            onRemove={() => onRemove(r.key)}
          />
        ))}
      </div>

      <div class="row" style="margin-top: var(--space-4);">
        <button onClick={onAdd}>+ Add mapping</button>
      </div>
    </section>
  );
}

function MappingRow(props: {
  row: Row;
  categories: api.MinifluxCategory[];
  playlists: api.YouTubePlaylist[];
  categoriesLoaded: Group['categoriesLoaded'];
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}): preact.JSX.Element {
  const { row, categories, playlists, categoriesLoaded, onChange, onRemove } = props;
  return (
    <div
      class="stack"
      style="padding: var(--space-3); border: 1px solid var(--color-line); background: var(--color-bg-elevated);"
    >
      <div class="field-row">
        <div class="field">
          <label>Miniflux category</label>
          {categoriesLoaded === 'loaded' && categories.length > 0 ? (
            <select
              value={row.minifluxCategory}
              onChange={(e) =>
                onChange({ minifluxCategory: (e.currentTarget as HTMLSelectElement).value })
              }
            >
              <option value="">— pick a category —</option>
              {categories.map((c) => (
                <option value={c.title}>{c.title}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={row.minifluxCategory}
              onInput={(e) =>
                onChange({ minifluxCategory: (e.currentTarget as HTMLInputElement).value })
              }
              placeholder={categoriesLoaded === 'loading' ? 'Loading…' : 'Category name'}
            />
          )}
        </div>
        <div class="field">
          <label>YouTube playlist</label>
          {playlists.length > 0 ? (
            <select
              value={row.youtubePlaylistId}
              onChange={(e) =>
                onChange({ youtubePlaylistId: (e.currentTarget as HTMLSelectElement).value })
              }
            >
              <option value="">— pick a playlist —</option>
              {playlists.map((p) => (
                <option value={p.id}>
                  {p.title} ({p.itemCount})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={row.youtubePlaylistId}
              onInput={(e) =>
                onChange({ youtubePlaylistId: (e.currentTarget as HTMLInputElement).value })
              }
              placeholder="PL…"
            />
          )}
        </div>
      </div>
      <div class="row" style="justify-content: space-between;">
        <label class="row" style="text-transform: none; letter-spacing: 0; font-size: var(--size-sm);">
          <input
            type="checkbox"
            checked={row.skipShorts}
            onInput={(e) =>
              onChange({ skipShorts: (e.currentTarget as HTMLInputElement).checked })
            }
            style="width: auto;"
          />
          <span>Skip shorts</span>
        </label>
        <button class="danger" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

function serialize(groups: Group[]): string {
  return JSON.stringify(
    groups.map((g) => ({
      i: g.instanceId,
      r: g.rows.map((r) => ({
        c: r.minifluxCategory,
        p: r.youtubePlaylistId,
        s: r.skipShorts,
      })),
    })),
  );
}

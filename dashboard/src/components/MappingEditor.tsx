// Mapping editor — Phase 10 redesign.
//
// One section per Miniflux instance, one row per mapping. Rows collapse
// to a summary (rss-node → flow-line → playlist-node + skip-shorts +
// filament status) and expand in-place to a raised card for editing.
// No modals; no toasts. A floating action bar pins to the viewport
// bottom when anything is dirty or a save is in flight.
//
// Six states per the design brief:
//   1. Empty          — instance has zero mappings.
//   2. Populated      — collapsed row summary + status icon.
//   3. Mid-edit       — one row expanded to an editing card.
//   4. Save-pending   — action bar pulses amber, editing area dims.
//   5. Save-error     — action bar turns danger; retry button appears.
//   6. Unreachable    — a row shows filament-error inline even outside
//                       edit mode, with an ambient error card below it.
//
// The whole component preserves the existing API contract
// (GET /api/mappings, PUT /api/mappings). Dirty tracking = serialize +
// compare against the initial snapshot taken on bootstrap.

import { useEffect, useMemo, useState } from 'preact/hooks';
import * as api from '../lib/api';
import { TubeIcon } from './icon/TubeIcon';

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

type SaveState = 'idle' | 'pending' | 'error';

let clientKeyCounter = 0;
function nextKey(): string {
  clientKeyCounter += 1;
  return `k-${clientKeyCounter}-${Date.now()}`;
}

// Filament-warmup: page-load animation on the signed-in root that fades
// in each row's filament status icon with a subtle stagger. Fires once
// per browser session per the design brief — sessionStorage flag gates
// re-plays on internal navigation. `prefers-reduced-motion` collapses
// the animation to the end state (CSS handles that).
const WARMUP_KEY = 'fluxtube:me-warmed';
const WARMUP_HOLD_MS = 800;

function useWarmup(): boolean {
  const [warming, setWarming] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(WARMUP_KEY) === null;
    } catch {
      // sessionStorage may be denied (Safari private mode etc.);
      // treat that as "never warmed" and skip the animation to
      // avoid re-animating on every navigation.
      return false;
    }
  });

  useEffect(() => {
    if (!warming) return;
    try {
      window.sessionStorage.setItem(WARMUP_KEY, '1');
    } catch {
      /* see comment above */
    }
    const t = window.setTimeout(() => setWarming(false), WARMUP_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [warming]);

  return warming;
}

export function MappingEditor(): preact.JSX.Element {
  const [groups, setGroups] = useState<Group[]>([]);
  const [playlists, setPlaylists] = useState<api.YouTubePlaylist[]>([]);
  const [ytConnected, setYtConnected] = useState<boolean | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initial, setInitial] = useState<string>('[]');
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  const warming = useWarmup();

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
      setEditing(new Set());
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
      prev.map((g) =>
        g.instanceId === instanceId ? { ...g, categoriesLoaded: 'loading' } : g,
      ),
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
    const key = nextKey();
    setGroups((prev) =>
      prev.map((g) =>
        g.instanceId === instanceId
          ? {
              ...g,
              rows: [
                ...g.rows,
                { key, minifluxCategory: '', youtubePlaylistId: '', skipShorts: false },
              ],
            }
          : g,
      ),
    );
    setEditing((prev) => new Set(prev).add(key));
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
        g.instanceId === instanceId ? { ...g, rows: g.rows.filter((r) => r.key !== key) } : g,
      ),
    );
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleEdit(key: string, open: boolean): void {
    setEditing((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const dirty = useMemo(() => serialize(groups) !== initial, [groups, initial]);

  function onDiscard(): void {
    if (saveState === 'pending') return;
    // Re-bootstrap re-reads from server, effectively discarding local edits.
    void bootstrap();
    setSaveState('idle');
    setSaveError(null);
  }

  async function onSave(): Promise<void> {
    if (!dirty || saveState === 'pending') return;
    setSaveState('pending');
    setSaveError(null);
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
      await bootstrap();
      setSaveState('idle');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveState('error');
    }
  }

  if (loading) return <p class="muted">Loading mappings…</p>;
  if (error)
    return (
      <div class="terminal" style="border-color: var(--color-danger);">
        {error}
      </div>
    );

  return (
    <div class={warming ? 'me me--warming' : 'me'}>
      {ytConnected === false && (
        <div class="me-banner me-banner--warn">
          <div>
            <h3 class="me-banner-title">YouTube not connected.</h3>
            <p class="me-banner-body">
              Connect a YouTube account so the sync worker can insert videos into your playlists.
            </p>
          </div>
          <a href={api.youtubeOAuthBeginUrl()} class="me-banner-cta">
            Connect YouTube
          </a>
        </div>
      )}
      {ytError && (
        <div class="me-banner me-banner--err">
          Couldn't list YouTube playlists: {ytError}
        </div>
      )}

      {groups.length === 0 && (
        <div class="me-noinstances">
          <TubeIcon name="filament-idle" size={48} />
          <h2 class="me-noinstances-title">No Miniflux instances yet.</h2>
          <p class="me-noinstances-body">
            Add one from settings, then come back to route each category to a YouTube playlist.
          </p>
          <a href="/dashboard/settings" class="me-noinstances-cta">
            Go to settings
          </a>
        </div>
      )}

      {groups.map((g) => (
        <InstanceSection
          key={g.instanceId}
          group={g}
          playlists={playlists}
          editing={editing}
          saveDisabled={saveState === 'pending'}
          onAdd={() => addRow(g.instanceId)}
          onChange={(key, patch) => updateRow(g.instanceId, key, patch)}
          onRemove={(key) => removeRow(g.instanceId, key)}
          onEditOpen={(key) => toggleEdit(key, true)}
          onEditClose={(key) => toggleEdit(key, false)}
          onReloadCategories={() => void loadCategories(g.instanceId)}
        />
      ))}

      {(dirty || saveState !== 'idle') && (
        <FloatingActionBar
          state={saveState}
          dirty={dirty}
          error={saveError}
          onSave={() => void onSave()}
          onDiscard={onDiscard}
        />
      )}
    </div>
  );
}

// ─── Instance section ────────────────────────────────────────────────

function InstanceSection(props: {
  group: Group;
  playlists: api.YouTubePlaylist[];
  editing: Set<string>;
  saveDisabled: boolean;
  onAdd: () => void;
  onChange: (key: string, patch: Partial<Row>) => void;
  onRemove: (key: string) => void;
  onEditOpen: (key: string) => void;
  onEditClose: (key: string) => void;
  onReloadCategories: () => void;
}): preact.JSX.Element {
  const {
    group,
    playlists,
    editing,
    saveDisabled,
    onAdd,
    onChange,
    onRemove,
    onEditOpen,
    onEditClose,
    onReloadCategories,
  } = props;
  const isEmpty = group.rows.length === 0;
  return (
    <section class="me-section">
      <header class="me-section-head">
        <span class="me-section-url" title={group.displayName}>
          {new URL(group.url).host}
        </span>
        {group.categoriesLoaded === 'error' && (
          <button class="me-section-retry" onClick={onReloadCategories}>
            Retry categories
          </button>
        )}
      </header>

      {group.categoriesError && (
        <div class="me-inline-err">
          Miniflux categories fetch failed: {group.categoriesError}
        </div>
      )}

      {isEmpty ? (
        <div class="me-empty">
          <TubeIcon name="filament-idle" size={48} />
          <h3 class="me-empty-headline">Route your first RSS category to a playlist.</h3>
          <p class="me-empty-body">
            FluxTube watches this Miniflux instance for YouTube URLs and drops them into the mapped
            playlist. Remove a video from the playlist when you're done — the corresponding RSS
            entry gets marked read on the next tick.
          </p>
          <p class="me-empty-hint">
            Miniflux categories are managed under Miniflux → Categories.
          </p>
          <button class="me-empty-cta" onClick={onAdd} disabled={saveDisabled}>
            <TubeIcon name="add" size={18} />
            Add a mapping
          </button>
        </div>
      ) : (
        <div class="me-rows">
          {group.rows.map((r) =>
            editing.has(r.key) ? (
              <RowEditor
                key={r.key}
                row={r}
                categories={group.categories}
                playlists={playlists}
                categoriesLoaded={group.categoriesLoaded}
                onChange={(patch) => onChange(r.key, patch)}
                onDone={() => onEditClose(r.key)}
                onRemove={() => onRemove(r.key)}
              />
            ) : (
              <RowSummary
                key={r.key}
                row={r}
                playlists={playlists}
                onEdit={() => onEditOpen(r.key)}
                onRemove={() => onRemove(r.key)}
              />
            ),
          )}
        </div>
      )}

      {!isEmpty && (
        <div class="me-section-foot">
          <button class="me-add-row" onClick={onAdd} disabled={saveDisabled}>
            <TubeIcon name="add" size={16} />
            Add mapping
          </button>
        </div>
      )}
    </section>
  );
}

// ─── Row: collapsed / summary ────────────────────────────────────────

function RowSummary(props: {
  row: Row;
  playlists: api.YouTubePlaylist[];
  onEdit: () => void;
  onRemove: () => void;
}): preact.JSX.Element {
  const { row, playlists, onEdit, onRemove } = props;
  // Reachability: if a playlist list has loaded and this row's playlist ID
  // isn't in it, we assume the playlist is unreachable (deleted, private,
  // wrong account). If the list hasn't loaded yet (playlists.length === 0),
  // don't jump to conclusions.
  const unreachable = playlists.length > 0 && !playlists.some((p) => p.id === row.youtubePlaylistId);
  const playlist = playlists.find((p) => p.id === row.youtubePlaylistId);
  const statusIcon: 'filament-active' | 'filament-idle' | 'filament-error' = unreachable
    ? 'filament-error'
    : 'filament-idle';
  const playlistLabel = playlist ? playlist.title : row.youtubePlaylistId || '(unset)';

  return (
    <div class={`me-row${unreachable ? ' me-row--err' : ''}`}>
      <div class="me-row-main">
        <span class="me-row-node">
          <TubeIcon name="rss-node" size={20} />
          <span class="me-row-label">{row.minifluxCategory || '(no category)'}</span>
        </span>
        <span class="me-row-flow" aria-hidden="true">
          <TubeIcon name="flow-line" size={20} />
        </span>
        <span class="me-row-node">
          <TubeIcon name="playlist-node" size={20} />
          <span class="me-row-label" title={row.youtubePlaylistId}>
            {playlistLabel}
          </span>
        </span>
        <span class="me-row-status">
          <TubeIcon name={statusIcon} size={16} />
        </span>
        <span class="me-row-actions">
          <button
            class="me-row-btn"
            onClick={onEdit}
            aria-label="Edit mapping"
            title="Edit mapping"
          >
            <TubeIcon name="save" size={18} variant="muted" />
          </button>
          <button
            class="me-row-btn"
            onClick={onRemove}
            aria-label="Remove mapping"
            title="Remove mapping"
          >
            <TubeIcon name="discard" size={18} variant="muted" />
          </button>
        </span>
      </div>
      {row.skipShorts && (
        <div class="me-row-caption">
          <span class="me-row-caption-tag">skip shorts</span>
        </div>
      )}
      {unreachable && (
        <div class="me-row-inline-err">
          <TubeIcon name="filament-error" size={16} />
          <div>
            <p>
              Playlist <code>{row.youtubePlaylistId}</code> not found on the connected YouTube
              account.
            </p>
            <p class="me-row-inline-err-fix">
              Check the ID, or reconnect YouTube in{' '}
              <a href="/dashboard/settings">settings</a>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Row: expanded / editor ─────────────────────────────────────────

function RowEditor(props: {
  row: Row;
  categories: api.MinifluxCategory[];
  playlists: api.YouTubePlaylist[];
  categoriesLoaded: Group['categoriesLoaded'];
  onChange: (patch: Partial<Row>) => void;
  onDone: () => void;
  onRemove: () => void;
}): preact.JSX.Element {
  const { row, categories, playlists, categoriesLoaded, onChange, onDone, onRemove } = props;
  const playlist = playlists.find((p) => p.id === row.youtubePlaylistId);
  return (
    <div class="me-row me-row--edit">
      <div class="me-edit-grid">
        <div class="me-edit-field">
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

        <div class="me-edit-field">
          <label>Playlist ID</label>
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
          {playlist && <p class="me-edit-hint">{playlist.title}</p>}
        </div>
      </div>

      <div class="me-edit-footer">
        <label class="me-edit-toggle">
          <input
            type="checkbox"
            checked={row.skipShorts}
            onInput={(e) =>
              onChange({ skipShorts: (e.currentTarget as HTMLInputElement).checked })
            }
          />
          <span>Skip YouTube Shorts</span>
        </label>
        <div class="me-edit-actions">
          <button class="me-edit-remove" onClick={onRemove}>
            <TubeIcon name="discard" size={16} variant="muted" />
            Remove mapping
          </button>
          <button class="me-edit-done" onClick={onDone}>
            Done editing
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Floating action bar ─────────────────────────────────────────────

function FloatingActionBar(props: {
  state: SaveState;
  dirty: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}): preact.JSX.Element {
  const { state, dirty, error, onSave, onDiscard } = props;
  const barClass =
    state === 'pending'
      ? 'me-actionbar me-actionbar--pending'
      : state === 'error'
        ? 'me-actionbar me-actionbar--error'
        : 'me-actionbar';
  return (
    <div class={barClass} role="status" aria-live="polite">
      <div class="me-actionbar-msg">
        {state === 'pending' && <span>Saving your mapping changes…</span>}
        {state === 'error' && (
          <span>
            <strong>Save failed.</strong>{' '}
            <span class="me-actionbar-detail">{error ?? 'Try again in a moment.'}</span>
          </span>
        )}
        {state === 'idle' && dirty && <span>You have unsaved changes.</span>}
      </div>
      <div class="me-actionbar-actions">
        <button
          class="me-actionbar-discard"
          onClick={onDiscard}
          disabled={state === 'pending'}
        >
          Discard
        </button>
        {state === 'pending' ? (
          <button class="me-actionbar-save me-actionbar-save--pending" disabled>
            <TubeIcon name="live-fetch" size={16} />
            Saving…
          </button>
        ) : state === 'error' ? (
          <button class="me-actionbar-save me-actionbar-save--error" onClick={onSave}>
            <TubeIcon name="filament-error" size={16} />
            Retry save
          </button>
        ) : (
          <button
            class="me-actionbar-save me-actionbar-save--primary"
            onClick={onSave}
            disabled={!dirty}
          >
            <TubeIcon name="save" size={16} />
            Save changes
          </button>
        )}
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

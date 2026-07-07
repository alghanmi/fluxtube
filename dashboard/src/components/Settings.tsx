// Config CRUD + Miniflux instance CRUD + connection status pills for the
// settings page.

import { useEffect, useState } from 'preact/hooks';
import * as api from '../lib/api';

type Toast = { kind: 'ok' | 'err'; message: string } | null;

export function Settings(): preact.JSX.Element {
  const [instances, setInstances] = useState<api.MinifluxInstance[] | null>(null);
  const [config, setConfig] = useState<api.ConfigState | null>(null);
  const [ytConnected, setYtConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap(): Promise<void> {
    setError(null);
    try {
      const [i, c] = await Promise.all([api.listInstances(), api.getConfig()]);
      setInstances(i);
      setConfig(c);
      try {
        await api.listPlaylists();
        setYtConnected(true);
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 409) setYtConnected(false);
        else setYtConnected(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function popToast(t: Toast): void {
    setToast(t);
    setTimeout(() => setToast(null), 3000);
  }

  if (error) return <div class="terminal" style="border-color: var(--color-danger);">{error}</div>;
  if (!instances || !config) return <p class="muted">Loading settings…</p>;

  return (
    <div class="stack">
      <MinifluxSection
        instances={instances}
        onChanged={async () => {
          setInstances(await api.listInstances());
        }}
        popToast={popToast}
      />
      <YouTubeSection connected={ytConnected} />
      <ConfigSection
        config={config}
        onChanged={async () => {
          setConfig(await api.getConfig());
        }}
        popToast={popToast}
      />
      {toast && <div class={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}

// ─── Miniflux CRUD ─────────────────────────────────────────────────────

function MinifluxSection(props: {
  instances: api.MinifluxInstance[];
  onChanged: () => Promise<void>;
  popToast: (t: Toast) => void;
}): preact.JSX.Element {
  const { instances, onChanged, popToast } = props;
  const [adding, setAdding] = useState(false);
  return (
    <section class="card">
      <h2 class="card-title">Miniflux instances</h2>
      <p class="card-subtitle">
        One or more Miniflux servers. Each is polled independently on every tick.
      </p>
      {instances.length === 0 && (
        <p class="muted xs">No instances configured yet.</p>
      )}
      <div class="stack">
        {instances.map((inst) => (
          <InstanceRow
            key={inst.id}
            instance={inst}
            onChanged={onChanged}
            popToast={popToast}
          />
        ))}
      </div>
      {adding ? (
        <InstanceForm
          onDone={async () => {
            setAdding(false);
            await onChanged();
            popToast({ kind: 'ok', message: 'Instance added' });
          }}
          onCancel={() => setAdding(false)}
          onError={(m) => popToast({ kind: 'err', message: m })}
        />
      ) : (
        <div class="row" style="margin-top: var(--space-4);">
          <button onClick={() => setAdding(true)}>+ Add instance</button>
        </div>
      )}
    </section>
  );
}

function InstanceRow(props: {
  instance: api.MinifluxInstance;
  onChanged: () => Promise<void>;
  popToast: (t: Toast) => void;
}): preact.JSX.Element {
  const { instance, onChanged, popToast } = props;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  async function onDelete(): Promise<void> {
    if (!confirm(`Delete "${instance.displayName}"? Its mappings are removed too.`)) return;
    setBusy(true);
    try {
      await api.deleteInstance(instance.id);
      await onChanged();
      popToast({ kind: 'ok', message: 'Instance removed' });
    } catch (err) {
      popToast({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }
  if (editing) {
    return (
      <InstanceForm
        instance={instance}
        onDone={async () => {
          setEditing(false);
          await onChanged();
          popToast({ kind: 'ok', message: 'Instance updated' });
        }}
        onCancel={() => setEditing(false)}
        onError={(m) => popToast({ kind: 'err', message: m })}
      />
    );
  }
  return (
    <div
      class="row"
      style="justify-content: space-between; padding: var(--space-3); border: 1px solid var(--color-line); background: var(--color-bg-elevated);"
    >
      <div>
        <div style="font-weight: 500;">{instance.displayName}</div>
        <div class="muted xs">{instance.url}</div>
      </div>
      <div class="row">
        <button onClick={() => setEditing(true)} disabled={busy}>
          Edit
        </button>
        <button class="danger" onClick={onDelete} disabled={busy}>
          Remove
        </button>
      </div>
    </div>
  );
}

function InstanceForm(props: {
  instance?: api.MinifluxInstance;
  onDone: () => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
}): preact.JSX.Element {
  const { instance, onDone, onCancel, onError } = props;
  const [displayName, setDisplayName] = useState(instance?.displayName ?? '');
  const [url, setUrl] = useState(instance?.url ?? '');
  const [apiToken, setApiToken] = useState('');
  const [busy, setBusy] = useState(false);
  const isEdit = !!instance;

  async function onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      if (isEdit) {
        const patch: Parameters<typeof api.updateInstance>[1] = {};
        if (displayName !== instance.displayName) patch.displayName = displayName;
        if (url !== instance.url) patch.url = url;
        if (apiToken) patch.apiToken = apiToken;
        if (Object.keys(patch).length === 0) {
          onCancel();
          return;
        }
        await api.updateInstance(instance.id, patch);
      } else {
        await api.createInstance({ displayName, url, apiToken });
      }
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      class="stack"
      style="padding: var(--space-3); border: 1px solid var(--color-line); background: var(--color-bg-elevated);"
    >
      <div class="field">
        <label>Display name</label>
        <input
          type="text"
          value={displayName}
          onInput={(e) => setDisplayName((e.currentTarget as HTMLInputElement).value)}
          required
        />
      </div>
      <div class="field">
        <label>URL</label>
        <input
          type="url"
          value={url}
          onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
          placeholder="https://miniflux.example"
          required
        />
      </div>
      <div class="field">
        <label>API token {isEdit && '(leave blank to keep the current one)'}</label>
        <input
          type="password"
          value={apiToken}
          onInput={(e) => setApiToken((e.currentTarget as HTMLInputElement).value)}
          autocomplete="off"
          required={!isEdit}
        />
      </div>
      <div class="row">
        <button class="primary" type="submit" disabled={busy}>
          {isEdit ? 'Save' : 'Add instance'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── YouTube ────────────────────────────────────────────────────────────

function YouTubeSection(props: { connected: boolean | null }): preact.JSX.Element {
  const { connected } = props;
  return (
    <section class="card">
      <h2 class="card-title">YouTube</h2>
      <p class="card-subtitle">
        The sync worker needs a stored OAuth refresh token to add videos to your playlists.
      </p>
      <div class="row">
        {connected === true && <span class="pill ok">connected</span>}
        {connected === false && <span class="pill warn">not connected</span>}
        {connected === null && <span class="pill">status unknown</span>}
        <a href={api.youtubeOAuthBeginUrl()} class="button">
          {connected ? 'Reconnect' : 'Connect'} YouTube
        </a>
      </div>
    </section>
  );
}

// ─── Config ─────────────────────────────────────────────────────────────

function ConfigSection(props: {
  config: api.ConfigState;
  onChanged: () => Promise<void>;
  popToast: (t: Toast) => void;
}): preact.JSX.Element {
  const { config, onChanged, popToast } = props;
  const [level, setLevel] = useState(config.sync_log_level ?? 'info');
  const [historyWindow, setHistoryWindow] = useState(
    config.history_window ? Number(config.history_window) : 10,
  );
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.setConfig('sync_log_level', level);
      await api.setConfig('history_window', historyWindow);
      await onChanged();
      popToast({ kind: 'ok', message: 'Config saved' });
    } catch (err) {
      popToast({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="card">
      <h2 class="card-title">Sync + history</h2>
      <div class="field-row">
        <div class="field">
          <label>Log level</label>
          <select
            value={level}
            onChange={(e) => setLevel((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>
        <div class="field">
          <label>History window (max snapshots kept)</label>
          <input
            type="number"
            min="1"
            max="100"
            value={historyWindow}
            onInput={(e) =>
              setHistoryWindow(Number((e.currentTarget as HTMLInputElement).value))
            }
          />
        </div>
      </div>
      <div class="row">
        <button class="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save config'}
        </button>
      </div>
    </section>
  );
}

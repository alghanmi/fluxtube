// Backup control panel — list, download, trigger, and hand off to the
// RestoreWizard when the operator picks a backup to restore. The default
// surface here is browse + trigger; restore takes over the whole panel
// as its own 5-step flow (see RestoreWizard).

import { useEffect, useState } from 'preact/hooks';
import * as api from '../lib/api';
import { TubeIcon } from './icon/TubeIcon';
import { RestoreWizard } from './RestoreWizard';

type Trigger =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string };

export function BackupPanel(): preact.JSX.Element {
  const [items, setItems] = useState<api.BackupObject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<Trigger>({ kind: 'idle' });
  const [restoreFilename, setRestoreFilename] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      setItems(await api.listBackupObjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onBackupNow(): Promise<void> {
    setTrigger({ kind: 'running' });
    try {
      await api.backupNow();
      await refresh();
      setTrigger({ kind: 'idle' });
    } catch (err) {
      setTrigger({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // While the wizard is active, replace the panel body with it.
  if (restoreFilename !== null && items !== null) {
    return (
      <RestoreWizard
        backups={items}
        initialFilename={restoreFilename}
        onExit={() => {
          setRestoreFilename(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div class="bp">
      <section class="bp-trigger">
        <div class="bp-trigger-copy">
          <h2 class="bp-title">Trigger backup now.</h2>
          <p class="bp-lede">
            Writes a fresh snapshot to R2 immediately. The nightly cron runs at{' '}
            <code>15 4 * * *</code> UTC — this is only needed before a risky change.
          </p>
        </div>
        <button
          class={
            trigger.kind === 'running'
              ? 'bp-run bp-run--pending'
              : 'bp-run'
          }
          onClick={() => void onBackupNow()}
          disabled={trigger.kind === 'running'}
        >
          {trigger.kind === 'running' && <TubeIcon name="live-fetch" size={16} />}
          {trigger.kind === 'running' ? 'Running…' : 'Run backup'}
        </button>
        {trigger.kind === 'error' && (
          <p class="bp-error" role="alert">
            <TubeIcon name="filament-error" size={16} /> {trigger.message}
          </p>
        )}
      </section>

      {error && (
        <div class="bp-load-error" role="alert">
          <TubeIcon name="filament-error" size={16} /> {error}
        </div>
      )}

      <section class="bp-list">
        <header class="bp-list-head">
          <h2 class="bp-list-title">Available backups.</h2>
          <span class="bp-list-hint">Newest first. Click a row to preview and restore.</span>
        </header>
        {items === null ? (
          <p class="muted">Loading…</p>
        ) : items.length === 0 ? (
          <div class="bp-empty">
            <TubeIcon name="backup-stale" size={40} />
            <p>No backups on record yet. The nightly cron will write the first one at 04:15 UTC.</p>
          </div>
        ) : (
          <ol class="bp-items">
            {items.map((b, i) => (
              <li class={`bp-item${i === 0 ? ' bp-item--newest' : ''}`}>
                <TubeIcon name={i === 0 ? 'backup-fresh' : 'backup-stale'} size={20} />
                <div class="bp-item-body">
                  <div class="bp-item-key">{b.key}</div>
                  <div class="bp-item-meta">
                    {b.uploadedAt} · {formatSize(b.sizeBytes)}
                  </div>
                </div>
                <div class="bp-item-actions">
                  <a href={api.backupDownloadUrl(b.key)} class="bp-item-download">
                    Download
                  </a>
                  <button
                    class="bp-item-restore"
                    onClick={() => setRestoreFilename(b.key)}
                  >
                    Preview & restore →
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

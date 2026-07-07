// Backup control panel — list, download, restore, trigger.

import { useEffect, useState } from 'preact/hooks';
import * as api from '../lib/api';

type Toast = { kind: 'ok' | 'err'; message: string } | null;

export function BackupPanel(): preact.JSX.Element {
  const [items, setItems] = useState<api.BackupObject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

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
    setTriggering(true);
    setToast(null);
    try {
      const r = await api.backupNow();
      setToast({ kind: 'ok', message: `Wrote ${r.key} (${formatSize(r.sizeBytes)})` });
      await refresh();
    } catch (err) {
      setToast({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTriggering(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  async function onRestore(filename: string): Promise<void> {
    if (
      !confirm(
        `Restore from ${filename}? Current mappings + Miniflux instances are replaced. You'll need to re-supply API tokens.`,
      )
    ) {
      return;
    }
    setRestoring(filename);
    setToast(null);
    try {
      const r = await api.restoreFromBackup(filename);
      setToast({
        kind: 'ok',
        message: `Restored: ${r.restoredInstances} instances, ${r.restoredMappings} mappings, ${r.restoredHistory} history rows`,
      });
    } catch (err) {
      setToast({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRestoring(null);
      setTimeout(() => setToast(null), 6000);
    }
  }

  return (
    <div class="stack">
      <section class="card">
        <h2 class="card-title">Trigger backup now</h2>
        <p class="card-subtitle">
          Writes a new backup to R2. The nightly cron does this automatically at 04:15 UTC.
        </p>
        <button class="primary" onClick={onBackupNow} disabled={triggering}>
          {triggering ? 'Running…' : 'Run backup'}
        </button>
      </section>

      {error && <div class="terminal" style="border-color: var(--color-danger);">{error}</div>}

      {items && (
        <section class="card">
          <h2 class="card-title">Available backups</h2>
          {items.length === 0 ? (
            <p class="muted xs">No backups yet.</p>
          ) : (
            <div class="stack">
              {items.map((b) => (
                <div
                  key={b.key}
                  class="row"
                  style="justify-content: space-between; padding: var(--space-3); border: 1px solid var(--color-line); background: var(--color-bg-elevated);"
                >
                  <div>
                    <div style="font-weight: 500;">{b.key}</div>
                    <div class="muted xs">
                      {b.uploadedAt} · {formatSize(b.sizeBytes)}
                    </div>
                  </div>
                  <div class="row">
                    <a href={api.backupDownloadUrl(b.key)} class="button">
                      Download
                    </a>
                    <button
                      class="danger"
                      onClick={() => void onRestore(b.key)}
                      disabled={restoring !== null}
                    >
                      {restoring === b.key ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {toast && <div class={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

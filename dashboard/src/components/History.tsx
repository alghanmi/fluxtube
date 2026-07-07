// Mapping snapshot history + restore.

import { useEffect, useState } from 'preact/hooks';
import * as api from '../lib/api';

type Toast = { kind: 'ok' | 'err'; message: string } | null;

export function History(): preact.JSX.Element {
  const [entries, setEntries] = useState<api.HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      setEntries(await api.getMappingHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRestore(id: number): Promise<void> {
    if (!confirm('Restore this snapshot? Current mappings will be replaced.')) return;
    setRestoring(id);
    setToast(null);
    try {
      const result = await api.restoreMappingHistory(id);
      setToast({
        kind: 'ok',
        message:
          result.skipped.length > 0
            ? `Restored — ${result.skipped.length} instance(s) skipped (missing)`
            : 'Restored',
      });
      await refresh();
    } catch (err) {
      setToast({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRestoring(null);
      setTimeout(() => setToast(null), 5000);
    }
  }

  if (error) return <div class="terminal" style="border-color: var(--color-danger);">{error}</div>;
  if (!entries) return <p class="muted">Loading history…</p>;
  if (entries.length === 0)
    return (
      <div class="card">
        <p class="muted">
          No snapshots yet. Every time you save mappings, a snapshot lands here so you can roll
          back.
        </p>
      </div>
    );

  return (
    <div class="stack">
      {entries.map((e) => (
        <article class="card" key={e.id}>
          <div class="row" style="justify-content: space-between;">
            <div>
              <div style="font-weight: 500;">{formatTs(e.createdAt)}</div>
              <div class="muted xs">
                actor: {e.actor} · id: {e.id}
              </div>
            </div>
            <div class="row">
              <button
                onClick={() => void onRestore(e.id)}
                disabled={restoring !== null}
              >
                {restoring === e.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
          <details style="margin-top: var(--space-3);">
            <summary class="muted xs" style="cursor: pointer;">
              Show snapshot payload
            </summary>
            <pre class="terminal" style="margin-top: var(--space-2); font-size: var(--size-xs);">
              {JSON.stringify(e.snapshot, null, 2)}
            </pre>
          </details>
        </article>
      ))}
      {toast && <div class={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}

function formatTs(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

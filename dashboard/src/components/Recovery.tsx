// Recovery flow — wipes the admin_passkey row iff the operator's code
// matches. Post-wipe, /claim opens for a fresh registration.

import { useState } from 'preact/hooks';
import * as api from '../lib/api';

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function Recovery(): preact.JSX.Element {
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!code.trim()) return;
    setPhase({ kind: 'submitting' });
    try {
      await api.recoverWithCode(code.trim());
      setPhase({ kind: 'done' });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (phase.kind === 'done') {
    return (
      <div class="card">
        <h2 class="card-title">Recovery complete</h2>
        <p class="card-subtitle">
          Your old passkey is invalidated. Register a new one to regain access.
        </p>
        <div class="row">
          <a href="/claim" class="button primary">
            Register a new passkey
          </a>
        </div>
      </div>
    );
  }

  return (
    <div class="card">
      <h2 class="card-title">Redeem recovery code</h2>
      <p class="card-subtitle">
        Paste the recovery code you saved when claiming this instance. Redeeming it wipes the
        registered passkey — you'll register a new one immediately after.
      </p>
      <form onSubmit={onSubmit} class="stack">
        <div class="field">
          <label for="recovery">Recovery code</label>
          <input
            id="recovery"
            type="password"
            autocomplete="off"
            value={code}
            onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        {phase.kind === 'error' && (
          <div class="terminal" style="border-color: var(--color-danger); color: var(--color-danger);">
            {phase.message}
          </div>
        )}
        <div class="row">
          <button
            class="primary"
            type="submit"
            disabled={phase.kind === 'submitting' || !code.trim()}
          >
            {phase.kind === 'submitting' ? 'Redeeming…' : 'Redeem'}
          </button>
          <a href="/" class="button">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}

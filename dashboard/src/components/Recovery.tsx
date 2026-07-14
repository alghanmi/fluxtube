// Recovery flow — wipes the admin_passkey row iff the operator's code
// matches. Post-wipe, /claim opens for a fresh registration.

import { useState } from 'preact/hooks';
import * as api from '../lib/api';
import { TubeIcon } from './icon/TubeIcon';

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
      <div class="claim">
        <h1 class="claim-hero">Recovery complete.</h1>
        <p class="claim-lede">
          Your old passkey is invalidated. Register a new one to regain access.
        </p>
        <div class="claim-actions">
          <a href="/claim" class="claim-primary">
            Register a new passkey
          </a>
        </div>
      </div>
    );
  }

  return (
    <div class="claim">
      <h1 class="claim-hero">Redeem recovery code.</h1>
      <p class="claim-lede">
        Paste the recovery code you saved when claiming this instance. Redeeming it wipes the
        registered passkey — you'll register a new one immediately after.
      </p>
      <form onSubmit={onSubmit} class="rc-form">
        <div class="rc-form-field">
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
          <div class="claim-error" role="alert">
            <TubeIcon name="filament-error" size={18} />
            <span>{phase.message}</span>
          </div>
        )}
        <div class="claim-actions">
          <button
            class="claim-primary"
            type="submit"
            disabled={phase.kind === 'submitting' || !code.trim()}
          >
            {phase.kind === 'submitting' ? 'Redeeming…' : 'Redeem code'}
          </button>
          <a href="/" class="claim-secondary">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}

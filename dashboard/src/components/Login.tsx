// Passkey authentication after the instance is already claimed.

import { useState } from 'preact/hooks';
import { startAuthentication } from '@simplewebauthn/browser';
import * as api from '../lib/api';

type Phase =
  | { kind: 'idle' }
  | { kind: 'authenticating' }
  | { kind: 'error'; message: string };

export function Login(): preact.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function onLogin(): Promise<void> {
    setPhase({ kind: 'authenticating' });
    try {
      const options = await api.authenticateBegin();
      const assertion = await startAuthentication({
        optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });
      await api.authenticateFinish(assertion);
      window.location.href = '/dashboard';
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div class="card">
      <h2 class="card-title">Sign in</h2>
      <p class="card-subtitle">
        Use the passkey you registered when claiming this instance. Your browser or authenticator
        will prompt you to confirm.
      </p>
      {phase.kind === 'error' && (
        <div class="terminal" style="border-color: var(--color-danger); color: var(--color-danger);">
          {phase.message}
        </div>
      )}
      <div class="row" style="margin-top: var(--space-4);">
        <button class="primary" onClick={onLogin} disabled={phase.kind === 'authenticating'}>
          {phase.kind === 'authenticating' ? 'Waiting for your key…' : 'Sign in with passkey'}
        </button>
        <a href="/recovery" class="button">
          Lost your passkey?
        </a>
      </div>
    </div>
  );
}

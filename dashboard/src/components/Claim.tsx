// One-time passkey registration for the first-boot claim flow.
//
// After success, the server returns a recovery code as plaintext. This is
// the ONLY moment the operator sees it — save it in a password manager or
// print it. The flow gates on "I've saved it" before redirecting into the
// dashboard.

import { useState } from 'preact/hooks';
import { startRegistration } from '@simplewebauthn/browser';
import * as api from '../lib/api';

type Phase =
  | { kind: 'idle' }
  | { kind: 'registering' }
  | { kind: 'recovery'; code: string; credentialId: string; backedUp: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function Claim(): preact.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [savedAck, setSavedAck] = useState(false);

  async function onClaim(): Promise<void> {
    setPhase({ kind: 'registering' });
    try {
      const options = await api.registerBegin();
      // @simplewebauthn/browser type: PublicKeyCredentialCreationOptionsJSON
      // We got it straight from our server so shape matches.
      const attestation = await startRegistration({
        optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'],
      });
      const finish = await api.registerFinish(attestation);
      setPhase({
        kind: 'recovery',
        code: finish.recoveryCode,
        credentialId: finish.credentialId,
        backedUp: finish.credentialBackedUp,
      });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard may be denied — user can still select + copy */
    }
  }

  if (phase.kind === 'recovery') {
    return (
      <div class="card">
        <h2 class="card-title">Save your recovery code</h2>
        <p class="card-subtitle">
          This code is the ONLY way back in if you lose your passkey. It's shown once, right now.
          Save it in your password manager (recommended) or print it. The dashboard has no way to
          show it again.
        </p>
        <div class="terminal" style="user-select: all;">{phase.code}</div>
        <div class="row" style="margin-top: var(--space-4);">
          <button onClick={() => copyCode(phase.code)}>Copy to clipboard</button>
          {phase.backedUp && <span class="pill ok">passkey synced to keychain</span>}
        </div>
        <label class="row" style="margin-top: var(--space-6); text-transform: none; letter-spacing: 0; font-size: var(--size-base);">
          <input
            type="checkbox"
            checked={savedAck}
            onInput={(e) => setSavedAck((e.currentTarget as HTMLInputElement).checked)}
            style="width: auto;"
          />
          <span>I've saved the recovery code somewhere safe.</span>
        </label>
        <div class="row" style="margin-top: var(--space-4);">
          <button
            class="primary"
            disabled={!savedAck}
            onClick={() => (window.location.href = '/dashboard')}
          >
            Continue to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="card">
      <h2 class="card-title">Claim this instance</h2>
      <p class="card-subtitle">
        Register a passkey to become the operator for this FluxTube instance. Only one operator per
        instance — after this, the register endpoint locks.
      </p>
      {phase.kind === 'error' && (
        <div class="terminal" style="border-color: var(--color-danger); color: var(--color-danger);">
          {phase.message}
        </div>
      )}
      <div class="row" style="margin-top: var(--space-4);">
        <button class="primary" onClick={onClaim} disabled={phase.kind === 'registering'}>
          {phase.kind === 'registering' ? 'Waiting for your key…' : 'Register passkey'}
        </button>
        <a href="/recovery" class="button">
          I already have a recovery code
        </a>
      </div>
    </div>
  );
}

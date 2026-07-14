// One-time passkey registration for the first-boot claim flow.
//
// Two phases the operator sees:
//
//   1. Claim button  — plain call-to-action; kicks off the WebAuthn ceremony.
//   2. Recovery code — displayed exactly once. This is the safety-critical
//                      moment in the whole product: Phase 10 design's hero
//                      screen. Fraunces headline, 40px amber code in a
//                      bordered surface, Bitwarden hint, Copy button with
//                      1.8s green-text feedback, and a Continue button
//                      that CONDITIONALLY MOUNTS (does not merely disable)
//                      only after the trust checkbox is ticked.

import { useEffect, useState } from 'preact/hooks';
import { startRegistration } from '@simplewebauthn/browser';
import * as api from '../lib/api';
import { TubeIcon } from './icon/TubeIcon';

type Phase =
  | { kind: 'idle' }
  | { kind: 'registering' }
  | { kind: 'recovery'; code: string; credentialId: string; backedUp: boolean }
  | { kind: 'error'; message: string };

export function Claim(): preact.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function onClaim(): Promise<void> {
    setPhase({ kind: 'registering' });
    try {
      const options = await api.registerBegin();
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

  if (phase.kind === 'recovery') {
    return <RecoveryCodeScreen code={phase.code} backedUp={phase.backedUp} />;
  }

  return (
    <div class="claim">
      <h1 class="claim-hero">Claim this instance.</h1>
      <p class="claim-lede">
        Register a passkey to become the operator for this FluxTube instance. Only one operator per
        instance — after this, the register endpoint locks.
      </p>
      {phase.kind === 'error' && (
        <div class="claim-error" role="alert">
          <TubeIcon name="filament-error" size={18} />
          <span>{phase.message}</span>
        </div>
      )}
      <div class="claim-actions">
        <button class="claim-primary" onClick={onClaim} disabled={phase.kind === 'registering'}>
          {phase.kind === 'registering' ? 'Waiting for your key…' : 'Register passkey'}
        </button>
        <a href="/recovery" class="claim-secondary">
          I already have a recovery code
        </a>
      </div>
    </div>
  );
}

// ─── The recovery-code screen ─────────────────────────────────────────

function RecoveryCodeScreen(props: { code: string; backedUp: boolean }): preact.JSX.Element {
  const { code, backedUp } = props;
  const [copied, setCopied] = useState(false);
  const [trusted, setTrusted] = useState(false);

  // Copied-state flash lives ~1.8s per the brief. Cleaned up on unmount so a
  // fast unmount + remount doesn't leak the timeout.
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard may be denied — the code is still selectable via the DOM.
    }
  }

  return (
    <div class="rc">
      <div class="rc-eyebrow">
        <TubeIcon name="encrypted" size={16} variant="muted" />
        <span>ONE-TIME VIEW</span>
      </div>

      <h1 class="rc-hero">Save this recovery code.</h1>

      <div class="rc-code-block">
        <code class="rc-code" aria-label="Recovery code">
          {code}
        </code>
      </div>

      <div class="rc-actions">
        <button
          class={copied ? 'rc-copy rc-copy--done' : 'rc-copy'}
          onClick={onCopy}
          aria-live="polite"
        >
          {copied ? 'Copied to clipboard.' : 'Copy to clipboard'}
        </button>
        {backedUp && (
          <span class="rc-synced">
            <TubeIcon name="filament-active" size={14} />
            passkey synced to keychain
          </span>
        )}
      </div>

      <div class="rc-context">
        <p>
          This is the only path back into FluxTube if you lose your passkey. It's shown once, right
          now — the dashboard cannot display it again, and only its SHA-256 hash exists in the
          database.
        </p>
        <p>
          Save it as a <em>Note</em> in your password manager under an item named{' '}
          <code>FluxTube / recovery / &lt;instance&gt;</code>. If you use Bitwarden, that convention
          keeps it findable alongside the rest of the FluxTube secrets.
        </p>
      </div>

      <label class="rc-trust">
        <input
          type="checkbox"
          checked={trusted}
          onInput={(e) => setTrusted((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>I've saved this in a place I trust.</span>
      </label>

      {/* Continue is conditionally MOUNTED, not disabled — per the brief's
          strict state-gating. The button does not exist until trust is
          affirmed. */}
      {trusted && (
        <a class="rc-continue" href="/dashboard">
          Continue to the dashboard →
        </a>
      )}
    </div>
  );
}

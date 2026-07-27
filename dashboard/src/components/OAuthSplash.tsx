// Transient full-page splash rendered after the YouTube OAuth
// callback. Success variant auto-redirects to /dashboard/settings
// after 1.5s. Error variant shows a Try Again link back into the
// OAuth flow.
//
// Per the Phase 10 design brief:
//   Success: 56px filament-active + Fraunces "YouTube connected." +
//            mono caption noting the auto-redirect.
//   Error:   56px filament-error + ink-red "Consent declined." +
//            explanatory line + Try Again link.

import { useEffect } from 'preact/hooks';
import * as api from '../lib/api';
import { TubeIcon } from './icon/TubeIcon';

interface Props {
  state: 'connected' | 'denied';
  reason?: string;
  message?: string;
}

const REDIRECT_MS = 1500;
const SETTINGS_URL = '/dashboard/settings';

function humanizeReason(reason?: string, message?: string): string {
  if (!reason) return 'Nothing was changed. Your last connection is still active.';
  if (message) return `${describeReason(reason)} — ${message}`;
  return describeReason(reason);
}

function describeReason(reason: string): string {
  switch (reason) {
    case 'access_denied':
    case 'oauth_error':
      return "Google reported that consent wasn't granted.";
    case 'missing_code_or_state':
      return 'The callback URL was missing required parameters.';
    case 'invalid_state':
      return "The state token didn't match — this may be a stale tab or a replay.";
    case 'token_exchange_failed':
      return "Google's token endpoint rejected the code.";
    case 'no_refresh_token_returned':
      return 'Google did not return a refresh token. Reconnect with a fresh consent.';
    case 'oauth_not_configured':
      return 'The dashboard Worker is missing OAuth credentials. Check the Worker secrets.';
    case 'keychain_missing':
    case 'keychain_invalid':
      return 'The at-rest encryption keychain is missing or invalid on the Worker.';
    default:
      return `The OAuth flow ended with reason \`${reason}\`.`;
  }
}

export function OAuthSplash(props: Props): preact.JSX.Element {
  const { state, reason, message } = props;

  useEffect(() => {
    if (state !== 'connected') return;
    const t = window.setTimeout(() => {
      window.location.replace(SETTINGS_URL);
    }, REDIRECT_MS);
    return () => window.clearTimeout(t);
  }, [state]);

  if (state === 'connected') {
    return (
      <div class="oauth">
        <TubeIcon name="filament-active" size={56} />
        <h1 class="oauth-hero oauth-hero--ok">YouTube connected.</h1>
        <p class="oauth-caption">
          Returning you to <code>/dashboard/settings</code>…
        </p>
        <noscript>
          <p class="oauth-noscript">
            JavaScript is disabled. <a href={SETTINGS_URL}>Continue to settings →</a>
          </p>
        </noscript>
      </div>
    );
  }

  return (
    <div class="oauth">
      <TubeIcon name="filament-error" size={56} />
      <h1 class="oauth-hero oauth-hero--err">Consent declined.</h1>
      <p class="oauth-body">{humanizeReason(reason, message)}</p>
      <div class="oauth-actions">
        <a href={api.youtubeOAuthBeginUrl()} class="oauth-retry">
          Try again →
        </a>
        <a href={SETTINGS_URL} class="oauth-back">
          Back to settings
        </a>
      </div>
    </div>
  );
}

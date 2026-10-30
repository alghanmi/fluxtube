import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { OAuthSplash, parseOAuthResult } from '../src/components/OAuthSplash';

// The page is built statically, so the variant must come from the query
// string the browser sees, not from anything fixed at build time.
describe('OAuthSplash', () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.appendChild(root);
    document.title = 'YouTube connection · fluxtube';
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  async function mountAt(search: string): Promise<void> {
    window.history.replaceState(null, '', `/dashboard/oauth${search}`);
    await act(() => {
      render(<OAuthSplash />, root);
    });
  }

  it('renders the success variant for ?state=connected', async () => {
    await mountAt('?state=connected');
    expect(root.textContent).toContain('YouTube connected.');
    expect(root.textContent).not.toContain('Consent declined');
    expect(document.title).toBe('YouTube connected · fluxtube');
  });

  it('renders the declined variant with fixed copy for ?state=denied', async () => {
    await mountAt('?state=denied&reason=access_denied');
    expect(root.textContent).toContain('Consent declined.');
    expect(root.textContent).toContain("Google reported that consent wasn't granted.");
    expect(document.title).toBe('YouTube consent declined · fluxtube');
  });

  it('treats a missing state as declined', async () => {
    await mountAt('');
    expect(root.textContent).toContain('Consent declined.');
  });
});

describe('parseOAuthResult', () => {
  it('only reports success for an explicit state=connected', () => {
    expect(parseOAuthResult('?state=connected')).toEqual({ state: 'connected' });
    expect(parseOAuthResult('?state=CONNECTED')).toEqual({ state: 'denied' });
    expect(parseOAuthResult('?state=denied&reason=invalid_state')).toEqual({
      state: 'denied',
      reason: 'invalid_state',
    });
  });
});

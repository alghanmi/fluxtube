// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// Phase 0: static build. Phase 6 flips this to `output: 'server'` with the
// Cloudflare adapter so Astro SSR endpoints can call the dashboard Worker
// via Service Binding (per the plan in
// ~/.claude/plans/a-few-things-to-expressive-shannon.md).
//
// `site` is intentionally left unset in the public source — the deploy
// companion injects the real value at build time via the `ASTRO_SITE` env
// override, so the private hostname stays out of the public repo.
export default defineConfig({
  integrations: [preact()],
  output: 'static',
  trailingSlash: 'never',
});

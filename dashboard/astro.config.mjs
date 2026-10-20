// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// Phase 0: static build. Phase 6 flips this to `output: 'server'` with the
// Cloudflare adapter so Astro SSR endpoints can call the dashboard Worker
// via Service Binding.
//
// `site` is intentionally left unset in the source — a deploy supplies the
// real value at build time via the `ASTRO_SITE` env override, so no
// deployment's hostname is committed here.
export default defineConfig({
  integrations: [preact()],
  output: 'static',
  trailingSlash: 'never',
});

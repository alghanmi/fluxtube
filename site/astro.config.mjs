// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://fluxtube.forklabs.cc',
  integrations: [mdx()],
  output: 'static',
  // The CSP in public/_headers allows no inline script or style, so the
  // build must emit none. Keep both settings below, and do not add
  // `is:inline`, `define:vars` or `style="…"` attributes to components.
  build: {
    // Page CSS is always written to /_astro/*.css, never inlined as <style>.
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Astro inlines any bundled <script> under this limit as
      // `<script type="module">…</script>`. Returning false for .js keeps
      // every script external; `undefined` keeps Vite's default 4 KiB
      // limit for other assets.
      assetsInlineLimit: (filePath) => (filePath.endsWith('.js') ? false : undefined),
    },
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  trailingSlash: 'never',
});

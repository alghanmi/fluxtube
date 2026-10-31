import { defineConfig } from 'vitest/config';

// Component tests for the Preact islands. happy-dom supplies `window` and
// `document`; nothing here touches the network.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});

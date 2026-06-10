import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // The real `server-only` module throws when imported outside an RSC
      // bundle; stub it so server-side data/parsing modules are unit-testable.
      'server-only': resolve(__dirname, 'src/test/stubs/server-only.ts'),
    },
  },
});

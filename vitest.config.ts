import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'apps/api/src/**/*.spec.ts', 'apps/web/src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./apps/web/vitest.setup.ts'],
  },
});

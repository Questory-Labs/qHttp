import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/ws.ts',
        'src/index.ts',
        'src/core/types.ts',
        'src/cache/cache-engine.interface.ts',
        'src/types/**',
        'src/http2.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 75,
        statements: 80,
      },
    },
  },
});

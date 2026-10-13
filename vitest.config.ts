import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    environmentMatchGlobs: [['test/react/**', 'jsdom']],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/*.ts',
        'src/core/types.ts',
        'src/resource/types.ts',
        'src/cache/cache-engine.interface.ts',
        'src/ws/ws-adapter.interface.ts',
        'src/types/**',
        'src/react/index.ts',
        'src/middleware/index.ts',
      ],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 85,
        statements: 85,
      },
    },
  },
});

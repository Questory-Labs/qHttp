import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    resource: 'src/resource.ts',
    ws: 'src/ws.ts',
    sse: 'src/sse.ts',
    http2: 'src/http2.ts',
    'http-cache': 'src/http-cache.ts',
    testing: 'src/testing.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  // Shared modules (ResourceStore, cache policy, utils) must exist once per
  // format so singletons and instanceof checks hold across entry points.
  splitting: true,
  treeshake: true,
  external: ['ws', 'http-cache-semantics', 'react', 'react-dom'],
});

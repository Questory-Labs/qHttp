import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/react.ts',
    'src/ws.ts',
    'src/http2.ts',
    'src/http-cache.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  splitting: false,
  treeshake: true,
  external: ['ws', 'http-cache-semantics', 'react', 'react-dom'],
});

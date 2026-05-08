import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// All modules must share the same React instance. Root node_modules/react is
// used by @testing-library/react; alias source-file imports to the same copy
// so jsx-runtime and react-dom agree on a single renderer.
const rootReact = path.resolve('./node_modules/react');
const rootReactDom = path.resolve('./node_modules/react-dom');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react\/jsx-dev-runtime$/, replacement: `${rootReact}/jsx-dev-runtime.js` },
      { find: /^react\/jsx-runtime$/, replacement: `${rootReact}/jsx-runtime.js` },
      { find: /^react-dom\/client$/, replacement: `${rootReactDom}/client.js` },
      { find: /^react-dom$/, replacement: rootReactDom },
      { find: /^react$/, replacement: rootReact },
    ],
  },
  test: {
    include: [
      'functions/**/*.test.ts',
      'website/src/**/*.test.{ts,tsx}',
    ],
    environmentMatchGlobs: [
      ['website/**', 'jsdom'],
      ['functions/**', 'node'],
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'functions/**/*.ts',
        'website/src/**/*.{ts,tsx}',
      ],
      exclude: [
        'functions/**/*.test.ts',
        'website/src/**/*.test.{ts,tsx}',
        'website/src/api/schema.d.ts',
        'website/src/main.tsx',
      ],
      // Threshold re-enabled once coverage reaches 80% across all source files.
      // thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});

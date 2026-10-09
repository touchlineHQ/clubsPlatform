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
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^react\/jsx-dev-runtime$/, replacement: `${rootReact}/jsx-dev-runtime.js` },
      { find: /^react\/jsx-runtime$/, replacement: `${rootReact}/jsx-runtime.js` },
      { find: /^react-dom\/client$/, replacement: `${rootReactDom}/client.js` },
      { find: /^react-dom$/, replacement: rootReactDom },
      { find: /^react$/, replacement: rootReact },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'functions',
          include: ['functions/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'website',
          include: ['website/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          server: {
            deps: {
              // Inline these so Vite's resolve.alias (react → root copy) applies to
              // their internal React imports, preventing the dual-React hook conflict.
              inline: [/@mantine\//, /@tabler\/icons-react/, /react-router/, /@floating-ui\//, /react-remove-scroll/, /react-style-singleton/, /use-callback-ref/, /use-sidecar/],
            },
          },
        },
      },
    ],
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
      // Vitest 4's v8 provider remaps coverage via the AST, which reports
      // fewer covered functions/branches for the same tests (vitest 2: 82.7% /
      // 81.0%; vitest 4: 78.5% / 71.6%). Floors for those two are lowered to
      // match; lines/statements are unchanged. Raise back as tests are added.
      thresholds: { lines: 80, functions: 78, branches: 70, statements: 80 },
    },
  },
});

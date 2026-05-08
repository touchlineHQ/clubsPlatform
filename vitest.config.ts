import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'functions/**/*.test.ts',
      'website/src/**/*.test.{ts,tsx}',
    ],
    environmentMatchGlobs: [
      ['website/**', 'jsdom'],
      ['functions/**', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'functions/lib/api-helpers.ts',
        'functions/lib/auth.ts',
        'functions/lib/secrets.ts',
        'website/src/utils/**/*.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});

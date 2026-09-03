import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// ── Environment polyfills ───────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // jsdom doesn't implement scrollIntoView. Mantine's Combobox calls it on a
  // timer when a dropdown opens, which surfaces as an unhandled error after the
  // test itself has already passed.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  if (!('ResizeObserver' in window)) {
    (window as unknown as Record<string, unknown>).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // jsdom implements no layout, so Element.prototype.scrollIntoView is absent.
  // Mantine's Combobox calls it from a zero-delay timer after an option is
  // selected (use-combobox's selectActiveOption), which lands as an unhandled
  // error outside any test and fails the whole run even when every test passes.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

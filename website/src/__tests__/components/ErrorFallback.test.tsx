import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Autocomplete, MantineProvider } from '@mantine/core';
import { ErrorFallback } from '../../components/ErrorFallback';

describe('ErrorFallback', () => {
  // The regression this guards: the fallback used to be a Mantine <Alert>,
  // but the error boundary rendering it sat OUTSIDE MantineProvider. So a
  // caught error produced a second, unhandled one — "MantineProvider was not
  // found in component tree" — and a blank page instead of a message.
  it('renders with no providers in the tree at all', () => {
    expect(() => render(<ErrorFallback />)).not.toThrow();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('still renders inside a provider', () => {
    expect(() =>
      render(
        <MantineProvider>
          <ErrorFallback />
        </MantineProvider>
      )
    ).not.toThrow();
  });
});

describe('Mantine duplicate option handling', () => {
  // Pins the upstream behaviour the loadClubSlugs() dedupe exists to avoid.
  // If a future Mantine version stops throwing, this test fails and the
  // dedupe can be reconsidered rather than cargo-culted.
  it('throws when an Autocomplete receives duplicate option values', () => {
    expect(() =>
      render(
        <MantineProvider>
          <Autocomplete label="Club Feed" data={['teversal', 'east-leake', 'teversal']} />
        </MantineProvider>
      )
    ).toThrow(/[Dd]uplicate/);
  });

  it('does not throw once the values are unique', () => {
    expect(() =>
      render(
        <MantineProvider>
          <Autocomplete label="Club Feed" data={['teversal', 'east-leake']} />
        </MantineProvider>
      )
    ).not.toThrow();
  });
});

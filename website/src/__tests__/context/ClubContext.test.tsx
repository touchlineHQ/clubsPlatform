import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClubContext, useClub } from '../../context/ClubContext';
import type { ClubEntry } from '../../types';

function TestConsumer() {
  const { clubSlug, isMultiClub, clubs } = useClub();
  return (
    <div>
      <span data-testid="slug">{clubSlug}</span>
      <span data-testid="multi">{String(isMultiClub)}</span>
      <span data-testid="count">{clubs.length}</span>
    </div>
  );
}

describe('ClubContext', () => {
  it('provides default values when no provider is present', () => {
    render(<TestConsumer />);
    expect(screen.getByTestId('slug').textContent).toBe('');
    expect(screen.getByTestId('multi').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('provides values from the provider', () => {
    const clubs: ClubEntry[] = [
      { id: 'c1', slug: 'test-club', name: 'Test FC' },
    ];
    render(
      <ClubContext.Provider value={{ clubSlug: 'test-club', isMultiClub: true, clubs }}>
        <TestConsumer />
      </ClubContext.Provider>,
    );
    expect(screen.getByTestId('slug').textContent).toBe('test-club');
    expect(screen.getByTestId('multi').textContent).toBe('true');
    expect(screen.getByTestId('count').textContent).toBe('1');
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { SectionProvider, useSection } from '../../context/SectionContext';

function SectionDisplay() {
  const { activeSection, setActiveSection } = useSection();
  return (
    <div>
      <div data-testid="section">{activeSection}</div>
      <button onClick={() => setActiveSection('seniors')}>set-seniors</button>
      <button onClick={() => setActiveSection('juniors')}>set-juniors</button>
    </div>
  );
}

describe('SectionProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to "all" when localStorage has no stored value', () => {
    render(<SectionProvider><SectionDisplay /></SectionProvider>);
    expect(screen.getByTestId('section')).toHaveTextContent('all');
  });

  it('reads the initial section from localStorage', () => {
    localStorage.setItem('activeSection', 'juniors');
    render(<SectionProvider><SectionDisplay /></SectionProvider>);
    expect(screen.getByTestId('section')).toHaveTextContent('juniors');
  });

  it('updates state when setActiveSection is called', () => {
    render(<SectionProvider><SectionDisplay /></SectionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'set-seniors' }));
    expect(screen.getByTestId('section')).toHaveTextContent('seniors');
  });

  it('persists the new value to localStorage when setActiveSection is called', () => {
    render(<SectionProvider><SectionDisplay /></SectionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'set-seniors' }));
    expect(localStorage.getItem('activeSection')).toBe('seniors');
  });

  it('updates to the latest value after multiple setActiveSection calls', () => {
    render(<SectionProvider><SectionDisplay /></SectionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'set-seniors' }));
    fireEvent.click(screen.getByRole('button', { name: 'set-juniors' }));
    expect(screen.getByTestId('section')).toHaveTextContent('juniors');
    expect(localStorage.getItem('activeSection')).toBe('juniors');
  });
});

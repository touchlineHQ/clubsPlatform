import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { HeroBanner } from '../../components/club/HeroBanner';
import { renderWithMantine } from '../test-utils';

describe('HeroBanner', () => {
  it('renders children', () => {
    renderWithMantine(<HeroBanner><span>Hero content</span></HeroBanner>);
    expect(screen.getByText('Hero content')).toBeTruthy();
  });

  it('renders the accent glow element by default', () => {
    const { container } = renderWithMantine(<HeroBanner><span>x</span></HeroBanner>);
    const glow = container.querySelector('[aria-hidden]');
    expect(glow).toBeTruthy();
  });

  it('does not render the accent glow when accentGlow=false', () => {
    const { container } = renderWithMantine(
      <HeroBanner accentGlow={false}><span>x</span></HeroBanner>,
    );
    const glow = container.querySelector('[aria-hidden]');
    expect(glow).toBeNull();
  });

  it('renders without error with custom padding', () => {
    renderWithMantine(
      <HeroBanner padding={16}><span>padded</span></HeroBanner>,
    );
    expect(screen.getByText('padded')).toBeTruthy();
  });
});

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { ContactPage } from '../../pages/ContactPage';
import { renderWithMantine } from '../test-utils';
import type { Club } from '../../types';

const baseClub: Club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Play hard',
  founded: 1990,
  email: 'contact@testfc.com',
  address: { line1: '1 Ground Lane', line2: 'Anytown', postcode: 'AB1 2CD' },
  what3words: 'apple.banana.cherry',
  socials: {
    facebook: 'https://facebook.com/testfc',
    instagram: 'https://instagram.com/testfc',
    twitter: 'https://twitter.com/testfc',
  },
  about: [],
  history: [],
  nav: [],
};

describe('ContactPage', () => {
  it('renders the page title', () => {
    renderWithMantine(<ContactPage club={baseClub} />);
    expect(screen.getByText('Contact Us')).toBeTruthy();
  });

  it('shows club email', () => {
    renderWithMantine(<ContactPage club={baseClub} />);
    expect(screen.getByText('contact@testfc.com')).toBeTruthy();
  });

  it('shows club address lines', () => {
    renderWithMantine(<ContactPage club={baseClub} />);
    expect(screen.getByText('1 Ground Lane')).toBeTruthy();
    expect(screen.getByText('AB1 2CD')).toBeTruthy();
  });

  it('shows what3words', () => {
    renderWithMantine(<ContactPage club={baseClub} />);
    expect(screen.getByText(/apple\.banana\.cherry/)).toBeTruthy();
  });

  it('shows Facebook link when configured', () => {
    renderWithMantine(<ContactPage club={baseClub} />);
    expect(screen.getByText(/Follow us on Facebook/)).toBeTruthy();
  });

  it('shows Instagram link when configured', () => {
    renderWithMantine(<ContactPage club={baseClub} />);
    expect(screen.getByText(/Follow us on Instagram/)).toBeTruthy();
  });

  it('shows Twitter link when configured', () => {
    renderWithMantine(<ContactPage club={baseClub} />);
    expect(screen.getByText(/Follow us on X/)).toBeTruthy();
  });

  it('does not show social links when set to "#"', () => {
    const club = {
      ...baseClub,
      socials: { facebook: '#', instagram: '#', twitter: '#' },
    };
    renderWithMantine(<ContactPage club={club} />);
    expect(screen.queryByText(/Follow us on Facebook/)).toBeNull();
    expect(screen.queryByText(/Follow us on Instagram/)).toBeNull();
    expect(screen.queryByText(/Follow us on X/)).toBeNull();
  });

  it('does not show email section when email is empty', () => {
    const club = { ...baseClub, email: '' };
    renderWithMantine(<ContactPage club={club} />);
    expect(screen.queryByText('contact@testfc.com')).toBeNull();
  });
});

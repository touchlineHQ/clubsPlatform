import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { AboutPage } from '../../pages/AboutPage';
import { renderWithMantine } from '../test-utils';
import type { Club } from '../../types';

const baseClub: Club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Play hard',
  founded: 1990,
  email: 'info@testfc.com',
  address: { line1: '1 Lane', line2: 'Town', postcode: 'AB1 2CD' },
  what3words: 'abc.def.ghi',
  socials: { facebook: '#', instagram: '#', twitter: '#' },
  about: [
    { icon: 'fa-heart', title: 'Community', text: 'We care about community.' },
    { icon: 'fa-trophy', title: 'Excellence', text: 'We strive for excellence.' },
  ],
  history: ['The club was founded in 1990.', 'We won the cup in 2010.'],
  nav: [],
  colours: 'Red and Black',
};

describe('AboutPage', () => {
  it('renders the club name in the banner', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText(/About Test FC/)).toBeTruthy();
  });

  it('renders the club tagline', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText('Play hard')).toBeTruthy();
  });

  it('renders the founded badge', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText(/Est\. 1990/)).toBeTruthy();
  });

  it('renders the colours badge', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText('Red and Black')).toBeTruthy();
  });

  it('renders club history paragraphs', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText(/founded in 1990/)).toBeTruthy();
    expect(screen.getByText(/won the cup in 2010/)).toBeTruthy();
  });

  it('renders Our Story section when history is present', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText('Our Story')).toBeTruthy();
  });

  it('renders about item titles in Who We Are section', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText('Community')).toBeTruthy();
    expect(screen.getByText('Excellence')).toBeTruthy();
  });

  it('renders Who We Are section when about items are present', () => {
    renderWithMantine(<AboutPage club={baseClub} />);
    expect(screen.getByText('Who We Are')).toBeTruthy();
  });

  it('shows fallback text when no history or about items', () => {
    const club = { ...baseClub, about: [], history: [] };
    renderWithMantine(<AboutPage club={club} />);
    expect(screen.getByText(/No club history or about information/)).toBeTruthy();
  });

  it('does not show Our Story section when history is empty', () => {
    const club = { ...baseClub, history: [] };
    renderWithMantine(<AboutPage club={club} />);
    expect(screen.queryByText('Our Story')).toBeNull();
  });
});

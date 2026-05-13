import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { MatchdayPage } from '../../pages/MatchdayPage';
import { renderWithMantine } from '../test-utils';
import type { Club, MatchdayItem } from '../../types';

const baseClub: Club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Play hard',
  founded: 1990,
  email: 'contact@testfc.com',
  address: { line1: '1 Ground Lane', line2: 'Anytown', postcode: 'AB1 2CD' },
  what3words: 'apple.banana.cherry',
  socials: { facebook: '#', instagram: '#', twitter: '#' },
  about: [],
  history: [],
  nav: [],
};

const items: MatchdayItem[] = [
  { icon: 'fa-car', title: 'Parking', text: 'Free parking available on site.' },
  { icon: 'fa-utensils', title: 'Refreshments', text: 'Hot drinks and snacks at the clubhouse.' },
];

describe('MatchdayPage', () => {
  it('renders the page title', () => {
    renderWithMantine(<MatchdayPage items={items} club={baseClub} />);
    expect(screen.getByText(/Matchday/i)).toBeTruthy();
  });

  it('shows the club address as subtitle', () => {
    renderWithMantine(<MatchdayPage items={items} club={baseClub} />);
    expect(screen.getByText(/1 Ground Lane/)).toBeTruthy();
  });

  it('renders matchday item titles', () => {
    renderWithMantine(<MatchdayPage items={items} club={baseClub} />);
    expect(screen.getByText('Parking')).toBeTruthy();
    expect(screen.getByText('Refreshments')).toBeTruthy();
  });

  it('renders matchday item text', () => {
    renderWithMantine(<MatchdayPage items={items} club={baseClub} />);
    expect(screen.getByText(/Free parking available/)).toBeTruthy();
  });

  it('does not render a ground image section when not set', () => {
    renderWithMantine(<MatchdayPage items={items} club={baseClub} />);
    expect(screen.queryByText('Getting Here')).toBeNull();
  });

  it('renders a ground image when set', () => {
    const club = { ...baseClub, groundImage: 'https://example.com/ground.jpg', groundImageAlt: 'The ground' };
    renderWithMantine(<MatchdayPage items={items} club={club} />);
    expect(screen.getByText('Getting Here')).toBeTruthy();
    const img = screen.getByAltText('The ground');
    expect(img.getAttribute('src')).toContain('ground.jpg');
  });

  it('renders matchday badges when set', () => {
    const club = { ...baseClub, matchdayBadges: [{ label: 'Free Entry', color: 'green' }] };
    renderWithMantine(<MatchdayPage items={items} club={club} />);
    expect(screen.getByText('Free Entry')).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithMantine } from '../test-utils';
import { PrivateClubNotice } from '../../components/PrivateClubNotice';

describe('PrivateClubNotice', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '', pathname: '/test-club/', replace: vi.fn() },
    });
  });

  it('explains that the site is not public yet', () => {
    renderWithMantine(<PrivateClubNotice multiClub={false} />);
    expect(screen.getByText('Not live yet')).toBeTruthy();
  });

  it.each([true, false])('keeps a login link for the club admin (multiClub=%s)', (multiClub) => {
    renderWithMantine(<PrivateClubNotice multiClub={multiClub} />);
    expect(screen.getByText(/Club admin\? Log in/).getAttribute('href')).toBe('#/login');
  });

  // The whole point of the card: an admin who lands on their own club's URL
  // while it's still private used to be bounced to a landing page that had
  // nothing to sign in with.
  it.each([true, false])('never redirects away (multiClub=%s)', (multiClub) => {
    renderWithMantine(<PrivateClubNotice multiClub={multiClub} />);
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('offers the platform as a way out on a multi-club deployment', () => {
    renderWithMantine(<PrivateClubNotice multiClub />);
    expect(screen.getByText('Browse clubs').getAttribute('href')).toBe('/');
  });

  it('omits the platform link on a single-club fork, which has no landing page', () => {
    renderWithMantine(<PrivateClubNotice multiClub={false} />);
    expect(screen.queryByText('Browse clubs')).toBeNull();
  });
});

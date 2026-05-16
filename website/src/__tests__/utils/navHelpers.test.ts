import { describe, it, expect } from 'vitest';
import { currentPageTitle, userInitials } from '../../utils/navHelpers';

describe('currentPageTitle', () => {
  it('maps exact path matches to their title', () => {
    expect(currentPageTitle('/')).toBe('Home');
    expect(currentPageTitle('/teams')).toBe('Teams');
    expect(currentPageTitle('/admin/payments')).toBe('Payments');
  });
  it('falls back to the longest prefix match for nested routes', () => {
    expect(currentPageTitle('/teams/u15')).toBe('Teams');
    expect(currentPageTitle('/admin/users/abc/edit')).toBe('Manage Users');
  });
  it('returns "" when the path is unknown', () => {
    expect(currentPageTitle('/somewhere-else')).toBe('');
  });
  it('does not treat "/" as a prefix match for nested routes', () => {
    // /unknown shouldn't degrade to 'Home' just because '/' is a registered key.
    expect(currentPageTitle('/unknown')).toBe('');
  });
});

describe('userInitials', () => {
  it('takes the first letter of the first two words, uppercase', () => {
    expect(userInitials('Alice Smith')).toBe('AS');
    expect(userInitials('alice smith')).toBe('AS');
  });
  it('handles a single-word name', () => {
    expect(userInitials('Admin')).toBe('A');
  });
  it('ignores extra whitespace and middle names', () => {
    expect(userInitials('  Anne   Marie   Jones ')).toBe('AM');
  });
  it('returns an empty string for an empty name', () => {
    expect(userInitials('')).toBe('');
  });
});

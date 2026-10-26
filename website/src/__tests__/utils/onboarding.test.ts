import { describe, it, expect } from 'vitest';
import { onboardingSteps, incompleteBeforeLive } from '../../utils/onboarding';
import type { AppData } from '../../types';

const blank: AppData = {
  club: {
    slug: 'new-fc', name: 'New FC', tagline: '', founded: 2026, email: '',
    address: { line1: '', line2: '', postcode: '' }, what3words: '',
    socials: { facebook: '', instagram: '', twitter: '' }, about: [], history: [],
  },
  teams: { sections: [] },
  committee: { committee: [] },
  registration: [], news: [], gallery: [], matchday: [],
  clubFeed: null, rawClubFeed: null, manualFixtures: [], liveTeams: [],
  sidebarFeeds: [], visibility: {},
} as AppData;

const done = (data: AppData, published = false) =>
  Object.fromEntries(onboardingSteps(data, published).map(s => [s.id, s.done]));

describe('onboardingSteps (#85)', () => {
  it('marks everything incomplete for a brand new private club', () => {
    expect(Object.values(done(blank)).every(v => v === false)).toBe(true);
  });

  it('needs both a badge and a primary colour for branding', () => {
    expect(done({ ...blank, club: { ...blank.club, badge: '/b.png' } }).branding).toBe(false);
    expect(done({ ...blank, club: { ...blank.club, badge: '/b.png', primaryColor: '#123456' } }).branding).toBe(true);
  });

  it('needs a section with at least one team, not an empty section', () => {
    const section = { id: 's', name: 'Juniors', subtitle: '', icon: '', teams: [] };
    expect(done({ ...blank, teams: { sections: [section] } }).teams).toBe(false);
    const team = { name: 'U9', description: '', manager: '', coach: '', contact: '' };
    expect(done({ ...blank, teams: { sections: [{ ...section, teams: [team] }] } }).teams).toBe(true);
  });

  it('accepts either a fixture feed or a manual fixture', () => {
    expect(done({ ...blank, club: { ...blank.club, clubFeedSlug: 'new-fc' } }).fixtures).toBe(true);
    const fx = { team: 'U9', date: '2026-11-01', time: '10:00', homeAway: 'home' as const, opponent: 'X', venue: '', competition: '', homeScore: null, awayScore: null };
    expect(done({ ...blank, manualFixtures: [fx] }).fixtures).toBe(true);
  });

  it('ignores committee rows with no name and whitespace-only links', () => {
    expect(done({ ...blank, committee: { committee: [{ role: 'Chair', name: ' ', contact: '' }] } }).committee).toBe(false);
    expect(done({ ...blank, committee: { committee: [{ role: 'Chair', name: 'Sam', contact: '' }] } }).committee).toBe(true);
    expect(done({ ...blank, club: { ...blank.club, channelUrl: '  ' } }).channel).toBe(false);
    expect(done({ ...blank, club: { ...blank.club, channelUrl: 'https://whatsapp.com/channel/x' } }).channel).toBe(true);
  });

  it('counts a news post and the published state', () => {
    expect(done({ ...blank, news: [{ title: 'Hi', text: '', link: '', linkText: '' }] }).news).toBe(true);
    expect(done(blank, true).live).toBe(true);
  });

  it('lists what is still to do before going live, without the go-live step', () => {
    const left = incompleteBeforeLive(onboardingSteps(blank, false));
    expect(left).toHaveLength(6);
    expect(left).not.toContain('Go live');
  });
});

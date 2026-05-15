import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { TeamsPage } from '../../pages/TeamsPage';
import { renderWithMantine, mockSection } from '../test-utils';
import type { TeamsData, LiveTeam } from '../../types';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const teamsData: TeamsData = {
  sections: [
    {
      id: 'seniors',
      name: 'Senior Teams',
      subtitle: 'Our adult sides',
      icon: 'fa-shield-alt',
      teams: [
        { name: 'First XI', description: 'Top team', manager: 'Dave', coach: 'Eve', contact: 'dave@club.com' },
      ],
    },
    {
      id: 'juniors',
      name: 'Junior Teams',
      subtitle: 'Youth football',
      icon: 'fa-child',
      teams: [
        { name: 'U11 Boys', description: '', manager: 'Alice', coach: 'Bob', contact: 'alice@club.com' },
        { name: 'U13 Girls', description: '', manager: 'Carol', coach: 'Dan', contact: 'carol@club.com' },
      ],
    },
  ],
};

const liveTeams: LiveTeam[] = [];

describe('TeamsPage', () => {
  it('renders all teams when section is "all"', () => {
    renderWithMantine(
      <TeamsPage teams={teamsData} liveTeams={liveTeams} />,
      { sectionValue: { ...mockSection, activeSection: 'all' } },
    );
    expect(screen.getByText('First XI')).toBeTruthy();
    expect(screen.getByText('U11 Boys')).toBeTruthy();
    expect(screen.getByText('U13 Girls')).toBeTruthy();
  });

  it('shows only seniors section teams when section is "seniors"', () => {
    renderWithMantine(
      <TeamsPage teams={teamsData} liveTeams={liveTeams} />,
      { sectionValue: { ...mockSection, activeSection: 'seniors' } },
    );
    expect(screen.getByText('First XI')).toBeTruthy();
    expect(screen.queryByText('U11 Boys')).toBeNull();
    expect(screen.queryByText('U13 Girls')).toBeNull();
  });

  it('shows only junior section teams when section is "juniors"', () => {
    renderWithMantine(
      <TeamsPage teams={teamsData} liveTeams={liveTeams} />,
      { sectionValue: { ...mockSection, activeSection: 'juniors' } },
    );
    expect(screen.queryByText('First XI')).toBeNull();
    expect(screen.getByText('U11 Boys')).toBeTruthy();
    expect(screen.getByText('U13 Girls')).toBeTruthy();
  });

  it('shows manager and coach info', () => {
    renderWithMantine(
      <TeamsPage teams={teamsData} liveTeams={liveTeams} />,
      { sectionValue: { ...mockSection, activeSection: 'seniors' } },
    );
    expect(screen.getByText(/Dave/)).toBeTruthy();
    expect(screen.getByText(/Eve/)).toBeTruthy();
  });

  it('renders with no teams without error', () => {
    renderWithMantine(
      <TeamsPage teams={{ sections: [] }} liveTeams={[]} />,
    );
    expect(screen.getByText(/Teams/)).toBeTruthy();
  });
});

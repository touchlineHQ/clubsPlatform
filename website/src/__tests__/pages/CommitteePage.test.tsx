import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { CommitteePage } from '../../pages/CommitteePage';
import { renderWithMantine } from '../test-utils';
import type { CommitteeData, TeamsData } from '../../types';

const committee: CommitteeData = {
  committee: [
    { role: 'Chairman', name: 'Alice Smith', contact: 'alice@club.com' },
    { role: 'Secretary', name: 'Bob Jones', contact: 'bob@club.com' },
  ],
};

const teams: TeamsData = {
  sections: [
    {
      id: 'seniors',
      name: 'Senior Teams',
      subtitle: '',
      icon: 'fa-shield-alt',
      teams: [
        { name: 'First XI', manager: 'Dave', coach: 'Eve', contact: 'dave@club.com', description: '' },
        { name: 'Reserves', manager: 'Frank', coach: 'Grace', contact: 'frank@club.com', description: '' },
      ],
    },
  ],
};

describe('CommitteePage', () => {
  it('renders the page title', () => {
    renderWithMantine(<CommitteePage committee={committee} teams={teams} />);
    expect(screen.getAllByText(/Committee/).length).toBeGreaterThan(0);
  });

  it('shows the correct subtitle with counts', () => {
    renderWithMantine(<CommitteePage committee={committee} teams={teams} />);
    expect(screen.getByText(/2 committee members/)).toBeTruthy();
    expect(screen.getByText(/2 team coaches/)).toBeTruthy();
  });

  it('renders committee member roles', () => {
    renderWithMantine(<CommitteePage committee={committee} teams={teams} />);
    expect(screen.getByText('Chairman')).toBeTruthy();
    expect(screen.getByText('Secretary')).toBeTruthy();
  });

  it('renders committee member names', () => {
    renderWithMantine(<CommitteePage committee={committee} teams={teams} />);
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    expect(screen.getByText('Bob Jones')).toBeTruthy();
  });

  it('renders team names in the managers section', () => {
    renderWithMantine(<CommitteePage committee={committee} teams={teams} />);
    expect(screen.getByText('First XI')).toBeTruthy();
    expect(screen.getByText('Reserves')).toBeTruthy();
  });

  it('renders section name label', () => {
    renderWithMantine(<CommitteePage committee={committee} teams={teams} />);
    expect(screen.getByText('Senior Teams')).toBeTruthy();
  });

  it('renders manager and coach info in team rows', () => {
    renderWithMantine(<CommitteePage committee={committee} teams={teams} />);
    expect(screen.getByText(/Manager: Dave/)).toBeTruthy();
    expect(screen.getByText(/Manager: Frank/)).toBeTruthy();
  });

  it('handles empty committee gracefully', () => {
    renderWithMantine(
      <CommitteePage committee={{ committee: [] }} teams={teams} />,
    );
    expect(screen.queryByText('Club Committee')).toBeNull();
  });

  it('handles empty teams gracefully', () => {
    renderWithMantine(
      <CommitteePage committee={committee} teams={{ sections: [] }} />,
    );
    expect(screen.queryByText('Managers & Coaches')).toBeNull();
  });
});

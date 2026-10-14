import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithMantine } from '../../test-utils';
import { FixturesForm } from '../../../components/customize/FixturesForm';
import type { ManualFixture } from '../../../types';

const entry: ManualFixture = {
  team: 'U12 Reds', date: '2026-11-07', time: '10:00', homeAway: 'home', opponent: 'Rivals',
  venue: '', competition: '', homeScore: null, awayScore: null,
};

describe('FixturesForm', () => {
  it('adds a blank home game', () => {
    const onChange = vi.fn();
    renderWithMantine(<FixturesForm fixtures={[]} teamNames={['U12 Reds']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Game/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ team: '', homeAway: 'home', homeScore: null })]);
  });

  it('shows the game title and removes it', () => {
    const onChange = vi.fn();
    renderWithMantine(<FixturesForm fixtures={[entry]} teamNames={[]} onChange={onChange} />);
    expect(screen.getByText('U12 Reds v Rivals')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('edits the opponent and records a score', () => {
    const onChange = vi.fn();
    renderWithMantine(<FixturesForm fixtures={[entry]} teamNames={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Opponent/), { target: { value: 'Blues' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ opponent: 'Blues' })]);
    fireEvent.change(screen.getByLabelText('Home score'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ homeScore: 3 })]);
  });

  it('clears a score back to unplayed', () => {
    const onChange = vi.fn();
    renderWithMantine(<FixturesForm fixtures={[{ ...entry, homeScore: 2, awayScore: 1 }]} teamNames={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Away score'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ awayScore: null })]);
  });

  it('shows field errors for an incomplete game', () => {
    renderWithMantine(<FixturesForm fixtures={[{ ...entry, opponent: '', homeScore: 2 }]} teamNames={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getByText('Enter both scores or neither')).toBeTruthy();
  });
});

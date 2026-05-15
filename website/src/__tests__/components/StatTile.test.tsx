import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { StatTileRow } from '../../components/club/StatTile';
import { renderWithMantine } from '../test-utils';

describe('StatTileRow', () => {
  const items = [
    { value: '1950', label: 'Founded' },
    { value: '75+', label: 'Years running' },
    { value: '3', label: 'Club values' },
  ];

  it('renders all stat values', () => {
    renderWithMantine(<StatTileRow items={items} />);
    expect(screen.getByText('1950')).toBeTruthy();
    expect(screen.getByText('75+')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders all stat labels', () => {
    renderWithMantine(<StatTileRow items={items} />);
    expect(screen.getByText('Founded')).toBeTruthy();
    expect(screen.getByText('Years running')).toBeTruthy();
    expect(screen.getByText('Club values')).toBeTruthy();
  });

  it('renders a single item without error', () => {
    renderWithMantine(<StatTileRow items={[{ value: '42', label: 'Members' }]} />);
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
  });

  it('renders with custom cols prop', () => {
    renderWithMantine(<StatTileRow items={items} cols={3} />);
    expect(screen.getAllByText(/Founded|Years running|Club values/).length).toBe(3);
  });
});

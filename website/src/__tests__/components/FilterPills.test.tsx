import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { FilterPills } from '../../components/club/FilterPills';
import { renderWithMantine } from '../test-utils';

const options = [
  { value: 'all', label: 'All' },
  { value: 'seniors', label: 'Seniors' },
  { value: 'juniors', label: 'Juniors' },
];

describe('FilterPills', () => {
  it('renders one button per option', () => {
    renderWithMantine(
      <FilterPills options={options} value="all" onChange={vi.fn()} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Seniors')).toBeTruthy();
    expect(screen.getByText('Juniors')).toBeTruthy();
  });

  it('calls onChange with the option value when clicked', () => {
    const onChange = vi.fn();
    renderWithMantine(
      <FilterPills options={options} value="all" onChange={onChange} />,
    );
    fireEvent.click(screen.getByText('Seniors'));
    expect(onChange).toHaveBeenCalledWith('seniors');
  });

  it('calls onChange when inactive option is clicked', () => {
    const onChange = vi.fn();
    renderWithMantine(
      <FilterPills options={options} value="seniors" onChange={onChange} />,
    );
    fireEvent.click(screen.getByText('All'));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('renders with an empty options array without error', () => {
    renderWithMantine(
      <FilterPills options={[]} value="all" onChange={vi.fn()} />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

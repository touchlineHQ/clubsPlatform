import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MatchdayForm } from '../../../components/customize/MatchdayForm';
import { renderWithMantine } from '../../test-utils';
import type { MatchdayItem } from '../../../types';

const emptyMatchday: MatchdayItem[] = [];
const oneItem: MatchdayItem[] = [{ icon: 'fa-parking', title: 'Parking', text: 'Free parking on site.' }];

describe('MatchdayForm', () => {
  it('renders without crashing with no items', () => {
    const onChange = vi.fn();
    renderWithMantine(<MatchdayForm matchday={emptyMatchday} onChange={onChange} />);
    expect(screen.getByText('Matchday Information')).toBeTruthy();
  });

  it('clicking Add Item calls onChange with new item', () => {
    const onChange = vi.fn();
    renderWithMantine(<MatchdayForm matchday={emptyMatchday} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ title: '' })]);
  });

  it('title field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<MatchdayForm matchday={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Parking'), { target: { value: 'New Parking' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ title: 'New Parking' })]);
  });

  it('text field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<MatchdayForm matchday={oneItem} onChange={onChange} />);
    const textarea = screen.getByDisplayValue('Free parking on site.');
    fireEvent.change(textarea, { target: { value: 'Updated text' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ text: 'Updated text' })]);
  });

  it('clicking Remove calls onChange with item removed', () => {
    const onChange = vi.fn();
    renderWithMantine(<MatchdayForm matchday={oneItem} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

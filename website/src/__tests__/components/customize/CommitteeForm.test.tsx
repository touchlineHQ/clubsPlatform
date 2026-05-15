import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { CommitteeForm } from '../../../components/customize/CommitteeForm';
import { renderWithMantine } from '../../test-utils';
import type { CommitteeData } from '../../../types';

const emptyCommittee: CommitteeData = { committee: [] };

const committeeWithMember: CommitteeData = {
  committee: [{ role: 'Chairman', name: 'John Smith', contact: 'john@fc.com' }],
};

describe('CommitteeForm', () => {
  it('renders without crashing with empty committee', () => {
    const onChange = vi.fn();
    renderWithMantine(<CommitteeForm committee={emptyCommittee} onChange={onChange} />);
    expect(screen.getByText('Committee & Staff')).toBeTruthy();
  });

  it('clicking Add Member calls onChange with new member', () => {
    const onChange = vi.fn();
    renderWithMantine(<CommitteeForm committee={emptyCommittee} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    expect(onChange).toHaveBeenCalledWith({ committee: [expect.objectContaining({ name: 'TBC' })] });
  });

  it('renders existing member and role field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<CommitteeForm committee={committeeWithMember} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Chairman'), { target: { value: 'President' } });
    expect(onChange).toHaveBeenCalledWith({ committee: [expect.objectContaining({ role: 'President' })] });
  });

  it('member name field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<CommitteeForm committee={committeeWithMember} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('John Smith'), { target: { value: 'Jane Smith' } });
    expect(onChange).toHaveBeenCalledWith({ committee: [expect.objectContaining({ name: 'Jane Smith' })] });
  });

  it('member contact field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<CommitteeForm committee={committeeWithMember} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('john@fc.com'), { target: { value: 'new@fc.com' } });
    expect(onChange).toHaveBeenCalledWith({ committee: [expect.objectContaining({ contact: 'new@fc.com' })] });
  });

  it('clicking Remove calls onChange with member removed', () => {
    const onChange = vi.fn();
    renderWithMantine(<CommitteeForm committee={committeeWithMember} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith({ committee: [] });
  });
});

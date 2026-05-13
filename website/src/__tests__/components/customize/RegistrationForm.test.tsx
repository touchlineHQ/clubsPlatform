import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { RegistrationForm } from '../../../components/customize/RegistrationForm';
import { renderWithMantine } from '../../test-utils';
import type { RegistrationItem } from '../../../types';

const emptyRegistration: RegistrationItem[] = [];
const oneItem: RegistrationItem[] = [
  { icon: 'fa-user-plus', title: 'Adult Membership', description: 'Join as adult.', link: 'https://pay.example.com', buttonText: 'Join Now' },
];

describe('RegistrationForm', () => {
  it('renders without crashing with no items', () => {
    const onChange = vi.fn();
    renderWithMantine(<RegistrationForm registration={emptyRegistration} onChange={onChange} />);
    expect(screen.getByText('Registration & Subscriptions')).toBeTruthy();
  });

  it('clicking Add Registration Option calls onChange with new item', () => {
    const onChange = vi.fn();
    renderWithMantine(<RegistrationForm registration={emptyRegistration} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Registration Option/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ title: '' })]);
  });

  it('title field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<RegistrationForm registration={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Adult Membership'), { target: { value: 'Senior Membership' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ title: 'Senior Membership' })]);
  });

  it('link field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<RegistrationForm registration={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('https://pay.example.com'), { target: { value: 'https://new.example.com' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ link: 'https://new.example.com' })]);
  });

  it('button text field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<RegistrationForm registration={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Join Now'), { target: { value: 'Sign Up' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ buttonText: 'Sign Up' })]);
  });

  it('clicking Remove calls onChange with item removed', () => {
    const onChange = vi.fn();
    renderWithMantine(<RegistrationForm registration={oneItem} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

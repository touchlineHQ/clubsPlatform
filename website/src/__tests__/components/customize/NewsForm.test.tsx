import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { NewsForm } from '../../../components/customize/NewsForm';
import { renderWithMantine } from '../../test-utils';
import type { NewsItem } from '../../../types';

const emptyNews: NewsItem[] = [];
const oneItem: NewsItem[] = [{ title: 'Club Update', text: 'Big news.', link: '#', linkText: 'Read More' }];

describe('NewsForm', () => {
  it('renders without crashing with no news', () => {
    const onChange = vi.fn();
    renderWithMantine(<NewsForm news={emptyNews} onChange={onChange} />);
    expect(screen.getByText('News Articles')).toBeTruthy();
  });

  it('clicking Add Article calls onChange with new item', () => {
    const onChange = vi.fn();
    renderWithMantine(<NewsForm news={emptyNews} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Article/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ title: '' })]);
  });

  it('title field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<NewsForm news={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Club Update'), { target: { value: 'New Title' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ title: 'New Title' })]);
  });

  it('link field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<NewsForm news={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('#'), { target: { value: 'https://example.com' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ link: 'https://example.com' })]);
  });

  it('link text field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<NewsForm news={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Read More'), { target: { value: 'Learn More' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ linkText: 'Learn More' })]);
  });

  it('clicking Remove calls onChange with item removed', () => {
    const onChange = vi.fn();
    renderWithMantine(<NewsForm news={oneItem} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { GalleryForm } from '../../../components/customize/GalleryForm';
import { renderWithMantine } from '../../test-utils';
import type { GalleryItem } from '../../../types';

const emptyGallery: GalleryItem[] = [];
const oneItem: GalleryItem[] = [{ src: 'images/photo1.jpg', caption: 'Team Photo' }];

describe('GalleryForm', () => {
  it('renders without crashing with empty gallery', () => {
    const onChange = vi.fn();
    renderWithMantine(<GalleryForm gallery={emptyGallery} onChange={onChange} />);
    expect(screen.getByText('Photo Gallery')).toBeTruthy();
  });

  it('clicking Add Photo calls onChange with new item', () => {
    const onChange = vi.fn();
    renderWithMantine(<GalleryForm gallery={emptyGallery} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Photo/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ caption: '' })]);
  });

  it('image path field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<GalleryForm gallery={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('images/photo1.jpg'), { target: { value: 'images/new.jpg' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ src: 'images/new.jpg' })]);
  });

  it('caption field change calls onChange', () => {
    const onChange = vi.fn();
    renderWithMantine(<GalleryForm gallery={oneItem} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Team Photo'), { target: { value: 'New Caption' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ caption: 'New Caption' })]);
  });

  it('clicking Remove calls onChange with item removed', () => {
    const onChange = vi.fn();
    renderWithMantine(<GalleryForm gallery={oneItem} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

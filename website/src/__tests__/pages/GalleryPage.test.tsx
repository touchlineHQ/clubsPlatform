import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { GalleryPage } from '../../pages/GalleryPage';
import { renderWithMantine } from '../test-utils';

describe('GalleryPage', () => {
  it('renders items with src as images with captions', () => {
    const items = [
      { src: 'https://example.com/photo.jpg', caption: 'Team photo' },
    ];
    renderWithMantine(<GalleryPage items={items} />);
    expect(screen.getByText('Team photo')).toBeTruthy();
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('photo.jpg');
  });

  it('renders items without src as placeholder with caption', () => {
    const items = [{ caption: 'Coming soon' }];
    renderWithMantine(<GalleryPage items={items} />);
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a mix of items with and without src', () => {
    const items = [
      { src: 'https://example.com/a.jpg', caption: 'Match day' },
      { caption: 'Placeholder' },
    ];
    renderWithMantine(<GalleryPage items={items} />);
    expect(screen.getByText('Match day')).toBeTruthy();
    expect(screen.getByText('Placeholder')).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('renders an empty gallery without error', () => {
    renderWithMantine(<GalleryPage items={[]} />);
    expect(screen.getByText('Gallery')).toBeTruthy();
  });
});

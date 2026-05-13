import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { NewsPage } from '../../pages/NewsPage';
import { renderWithMantine, mockSection } from '../test-utils';
import type { NewsItem } from '../../types';

const seniorsItem: NewsItem = {
  title: 'Seniors Win Cup',
  text: 'Great result for the senior side',
  link: '/news/seniors-win',
  linkText: 'Read More',
  sections: ['seniors'],
};

const juniorsItem: NewsItem = {
  title: 'Juniors Delight',
  text: 'Young players shine',
  link: '/news/juniors',
  linkText: 'Read More',
  sections: ['juniors'],
};

const itemWithBody: NewsItem = {
  title: 'Big Story',
  text: 'Introduction text',
  body: 'Para one.\n\nPara two.',
  link: '/news/big-story',
  linkText: 'Read More',
};

describe('NewsPage', () => {
  it('renders all items when section is "all"', () => {
    renderWithMantine(
      <NewsPage items={[seniorsItem, juniorsItem]} />,
      { sectionValue: { ...mockSection, activeSection: 'all' } },
    );
    expect(screen.getByText('Seniors Win Cup')).toBeTruthy();
    expect(screen.getByText('Juniors Delight')).toBeTruthy();
  });

  it('filters to matching section only', () => {
    renderWithMantine(
      <NewsPage items={[seniorsItem, juniorsItem]} />,
      { sectionValue: { ...mockSection, activeSection: 'seniors' } },
    );
    expect(screen.getByText('Seniors Win Cup')).toBeTruthy();
    expect(screen.queryByText('Juniors Delight')).toBeNull();
  });

  it('renders empty list without error', () => {
    renderWithMantine(<NewsPage items={[]} />);
    expect(screen.getByText('Club News')).toBeTruthy();
  });

  it('renders an item with a body as expandable via button', () => {
    renderWithMantine(<NewsPage items={[itemWithBody]} />);
    expect(screen.getByText('Introduction text')).toBeTruthy();
    const expandBtn = screen.getByRole('button', { name: /Read More/i });
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn);
    expect(screen.getByText('Para one.')).toBeTruthy();
  });

  it('collapses body text when Show Less is clicked', () => {
    renderWithMantine(<NewsPage items={[itemWithBody]} />);
    fireEvent.click(screen.getByRole('button', { name: /Read More/i }));
    fireEvent.click(screen.getByRole('button', { name: /Show Less/i }));
    expect(screen.queryByRole('button', { name: /Show Less/i })).toBeNull();
  });

  it('renders an external link for items without body', () => {
    renderWithMantine(<NewsPage items={[seniorsItem]} />);
    const link = screen.getByRole('link', { name: /Read More/i });
    expect(link.getAttribute('href')).toBe('/news/seniors-win');
  });
});

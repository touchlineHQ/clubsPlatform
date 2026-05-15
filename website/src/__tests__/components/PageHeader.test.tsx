import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { PageHeader } from '../../components/club/PageHeader';
import { renderWithMantine } from '../test-utils';

describe('PageHeader', () => {
  it('renders the title', () => {
    renderWithMantine(<PageHeader title="News" />);
    expect(screen.getByText('News')).toBeTruthy();
  });

  it('renders the subtitle when provided', () => {
    renderWithMantine(<PageHeader title="Gallery" subtitle="Photos from the season" />);
    expect(screen.getByText('Photos from the season')).toBeTruthy();
  });

  it('does not render subtitle element when omitted', () => {
    renderWithMantine(<PageHeader title="News" />);
    expect(screen.queryByText('Photos from the season')).toBeNull();
  });

  it('renders the actions slot when provided', () => {
    renderWithMantine(
      <PageHeader title="Teams" actions={<button>Filter</button>} />,
    );
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
  });

  it('renders the below slot when provided', () => {
    renderWithMantine(
      <PageHeader title="Teams" below={<div>Below content</div>} />,
    );
    expect(screen.getByText('Below content')).toBeTruthy();
  });

  it('renders without actions or below slots', () => {
    renderWithMantine(<PageHeader title="Contact" />);
    expect(screen.getByText('Contact')).toBeTruthy();
  });
});

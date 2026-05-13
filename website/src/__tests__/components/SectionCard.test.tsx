import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { SectionCard } from '../../components/club/SectionCard';
import { renderWithMantine } from '../test-utils';

describe('SectionCard', () => {
  it('renders children content', () => {
    renderWithMantine(
      <SectionCard>
        <p>Hello world</p>
      </SectionCard>,
    );
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('renders title when provided', () => {
    renderWithMantine(
      <SectionCard title="Upcoming Fixtures">
        <p>content</p>
      </SectionCard>,
    );
    expect(screen.getByText('Upcoming Fixtures')).toBeTruthy();
  });

  it('renders trailing when provided', () => {
    renderWithMantine(
      <SectionCard title="News" trailing={<a href="/news">View all</a>}>
        <p>content</p>
      </SectionCard>,
    );
    expect(screen.getByText('View all')).toBeTruthy();
  });

  it('renders without title bar when no title is provided', () => {
    renderWithMantine(
      <SectionCard>
        <p>no title here</p>
      </SectionCard>,
    );
    expect(screen.getByText('no title here')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders without errors when noPadding is set', () => {
    renderWithMantine(
      <SectionCard noPadding>
        <p>no padding content</p>
      </SectionCard>,
    );
    expect(screen.getByText('no padding content')).toBeTruthy();
  });
});

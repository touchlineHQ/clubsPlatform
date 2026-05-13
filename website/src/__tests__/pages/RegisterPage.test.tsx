import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { RegisterPage } from '../../pages/RegisterPage';
import { renderWithMantine } from '../test-utils';
import type { RegistrationItem } from '../../types';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const items: RegistrationItem[] = [
  {
    icon: 'fa-child',
    title: 'Youth Teams',
    description: 'For kids aged 5-16',
    link: 'https://example.com/register/youth',
    buttonText: 'Sign Up Now',
  },
  {
    icon: 'fa-users',
    title: 'Senior Teams',
    description: 'For adults',
    link: 'https://example.com/register/senior',
    buttonText: 'Register',
  },
];

describe('RegisterPage', () => {
  it('renders the page title', () => {
    renderWithMantine(<RegisterPage items={items} />);
    expect(screen.getByText(/Registration/)).toBeTruthy();
  });

  it('renders all registration item titles', () => {
    renderWithMantine(<RegisterPage items={items} />);
    expect(screen.getByText('Youth Teams')).toBeTruthy();
    expect(screen.getByText('Senior Teams')).toBeTruthy();
  });

  it('renders all registration item descriptions', () => {
    renderWithMantine(<RegisterPage items={items} />);
    expect(screen.getByText('For kids aged 5-16')).toBeTruthy();
    expect(screen.getByText('For adults')).toBeTruthy();
  });

  it('renders external link buttons with correct href', () => {
    renderWithMantine(<RegisterPage items={items} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map(l => l.getAttribute('href'));
    expect(hrefs).toContain('https://example.com/register/youth');
    expect(hrefs).toContain('https://example.com/register/senior');
  });

  it('renders with an empty items array without error', () => {
    renderWithMantine(<RegisterPage items={[]} />);
    expect(screen.getByText(/Registration/)).toBeTruthy();
  });
});

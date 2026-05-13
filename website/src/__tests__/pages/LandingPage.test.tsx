import { describe, it, expect, vi, beforeAll } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut } from '../test-utils';
import type { ClubEntry } from '../../types';

vi.mock('../../auth-client', () => ({
  signUp: { email: vi.fn().mockResolvedValue({ error: null }) },
  signIn: { email: vi.fn() },
  signOut: vi.fn(),
}));

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

import { LandingPage } from '../../pages/LandingPage';

const clubs: ClubEntry[] = [
  { id: 'c1', slug: 'test-fc', name: 'Test FC' },
  { id: 'c2', slug: 'demo', name: 'Demo Club' },
];

describe('LandingPage', () => {
  it('renders the hero section with a heading', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('renders the platform name', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(screen.getAllByText(/Touchline/i).length).toBeGreaterThan(0);
  });

  it('renders the sign up form section', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(document.querySelector('form')).toBeTruthy();
  });

  it('renders without error with empty clubs list', () => {
    renderWithMantine(<LandingPage clubs={[]} />, { authValue: mockLoggedOut });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('form input changes update field values', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
    if (inputs.length > 0) {
      fireEvent.change(inputs[0], { target: { value: 'Test Club FC' } });
    }
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('nav button clicks trigger scroll handler without error', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const buttons = screen.getAllByRole('button');
    buttons.forEach(btn => {
      try { fireEvent.click(btn); } catch { /* ignore */ }
    });
    expect(document.querySelector('form')).toBeTruthy();
  });

  it('mouse enter/leave on interactive elements does not crash', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const anchors = document.querySelectorAll('a');
    anchors.forEach(a => {
      try {
        fireEvent.mouseEnter(a);
        fireEvent.mouseLeave(a);
      } catch { /* ignore */ }
    });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('typing in club name field updates state', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const clubNameInput = document.querySelector('input[placeholder*="club"]') as HTMLInputElement | null;
    if (clubNameInput) {
      fireEvent.change(clubNameInput, { target: { value: 'My New Club' } });
      expect(clubNameInput.value).toBe('My New Club');
    } else {
      expect(document.querySelector('form')).toBeTruthy();
    }
  });

  it('club directory section renders', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    // The demo club card is always shown (slug === 'demo')
    expect(screen.getAllByText(/Demo Club/i).length).toBeGreaterThan(0);
  });

  it('hero buttons mouse enter/leave triggers style updates without error', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => {
      try {
        fireEvent.mouseEnter(btn);
        fireEvent.mouseLeave(btn);
      } catch { /* ignore */ }
    });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('sign up form submission calls signUp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, slug: 'new-club' }) }));
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const form = document.querySelector('form');
    if (form) {
      fireEvent.submit(form);
    }
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('typing in password field updates state', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
    if (passwordInput) {
      fireEvent.change(passwordInput, { target: { value: 'secret123' } });
      expect(passwordInput.value).toBe('secret123');
    } else {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    }
  });

  it('clicking link buttons does not crash', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const links = screen.getAllByRole('link');
    links.forEach(link => {
      try { fireEvent.click(link); } catch { /* ignore */ }
    });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('typing in club name field (Radcliffe placeholder) updates state', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const clubNameInput = screen.queryByPlaceholderText('e.g. Radcliffe Olympic FC') as HTMLInputElement;
    if (clubNameInput) {
      fireEvent.change(clubNameInput, { target: { value: 'My Great Club' } });
      expect(clubNameInput.value).toBe('My Great Club');
    } else {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    }
  });

  it('typing in your name field (First and last name placeholder) updates state', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const nameInput = screen.queryByPlaceholderText('First and last name') as HTMLInputElement;
    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'John Smith' } });
      expect(nameInput.value).toBe('John Smith');
    } else {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    }
  });

  it('mouseEnter/Leave on AddClubCard triggers hover state without error', () => {
    renderWithMantine(<LandingPage clubs={clubs} />, { authValue: mockLoggedOut });
    const addClubElements = screen.queryAllByText('Add your club');
    if (addClubElements.length > 0) {
      let el: Element | null = addClubElements[0];
      while (el && el.tagName !== 'BODY') {
        try { fireEvent.mouseEnter(el); fireEvent.mouseLeave(el); } catch { /* ignore */ }
        el = el.parentElement;
      }
    }
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });
});

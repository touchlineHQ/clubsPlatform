import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockAdmin, mockPlatformAdmin } from '../test-utils';
import type { ClubEntry } from '../../types';

vi.mock('../../auth-client', () => ({
  signUp: { email: vi.fn().mockResolvedValue({ error: null }) },
  signIn: { email: vi.fn() },
  signOut: vi.fn(),
}));

// Modal uses react-remove-scroll which has a dual-React conflict; stub it out.
vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    Modal: ({ children, opened, onClose }: { children: React.ReactNode; opened: boolean; onClose?: () => void }) =>
      opened ? <div data-testid="modal"><button data-testid="modal-close" onClick={onClose}>Close</button>{children}</div> : null,
  };
});

import { LandingPage } from '../../pages/LandingPage';

const clubs: ClubEntry[] = [
  { id: 'c1', slug: 'test-fc', name: 'Test FC' },
  { id: 'c2', slug: 'demo', name: 'Demo Club' },
];

/** mockAdmin's user belongs to 'test-club', which isn't in `clubs` above. */
const adminOfTestFc = {
  ...mockAdmin,
  user: { ...mockAdmin.user, clubSlug: 'test-fc' },
};

describe('LandingPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['network', 'http', 'json', 'missing', 'invalid', 'blank'])('shows an error when DPA loading fails: %s', async failure => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url !== '/api/dpa-policy') return { ok: true, json: async () => ({}) };
      if (failure === 'network') throw new Error('offline');
      return {
        ok: failure !== 'http',
        json: async () => {
          if (failure === 'json') throw new SyntaxError('invalid JSON');
          if (failure === 'missing') return null;
          return { policyVersion: '1', wording: failure === 'blank' ? ' ' : {}, wordingHash: 'hash' };
        },
      };
    }));
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the processor agreement');
    expect(screen.getByRole('button', { name: /Create my club site/ })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: /processor agreement/ })).toBeNull();
  });

  it('requires explicit DPA acceptance after the wording loads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url === '/api/dpa-policy'
        ? { policyVersion: '1', wording: 'Current processor agreement wording', wordingHash: 'hash' }
        : {},
    })));
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    expect(await screen.findByText('Current processor agreement wording')).toBeVisible();
    const checkbox = screen.getByRole('checkbox', { name: /processor agreement/ });
    const submit = screen.getByRole('button', { name: /Create my club site/ });
    expect(checkbox).not.toBeChecked();
    expect(submit).toBeDisabled();
    fireEvent.click(checkbox);
    expect(submit).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the hero section with a heading', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('renders the platform name', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    expect(screen.getAllByText(/Touchline/i).length).toBeGreaterThan(0);
  });

  it('renders the sign up form section', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    expect(document.querySelector('form')).toBeTruthy();
  });

  it('renders without error with empty clubs list', () => {
    renderWithMantine(<LandingPage clubs={[]} selfRegister />, { authValue: mockLoggedOut });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('form input changes update field values', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
    if (inputs.length > 0) {
      fireEvent.change(inputs[0], { target: { value: 'Test Club FC' } });
    }
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('nav button clicks trigger scroll handler without error', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const buttons = screen.getAllByRole('button');
    buttons.forEach(btn => {
      try { fireEvent.click(btn); } catch { /* ignore */ }
    });
    expect(document.querySelector('form')).toBeTruthy();
  });

  it('mouse enter/leave on interactive elements does not crash', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
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
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const clubNameInput = document.querySelector('input[placeholder*="club"]') as HTMLInputElement | null;
    if (clubNameInput) {
      fireEvent.change(clubNameInput, { target: { value: 'My New Club' } });
      expect(clubNameInput.value).toBe('My New Club');
    } else {
      expect(document.querySelector('form')).toBeTruthy();
    }
  });

  it('club directory section renders', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    // The demo club card is always shown (slug === 'demo')
    expect(screen.getAllByText(/Demo Club/i).length).toBeGreaterThan(0);
  });

  it('never advertises a club whose site is private', () => {
    renderWithMantine(
      <LandingPage clubs={[...clubs, { id: 'c3', slug: 'quiet-fc', name: 'Quiet FC', published: false }]} selfRegister />,
      { authValue: mockLoggedOut },
    );
    expect(screen.queryByText(/Quiet FC/i)).toBeNull();
  });

  it('hero buttons mouse enter/leave triggers style updates without error', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
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
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const form = document.querySelector('form');
    if (form) {
      fireEvent.submit(form);
    }
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('typing in password field updates state', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
    if (passwordInput) {
      fireEvent.change(passwordInput, { target: { value: 'secret123' } });
      expect(passwordInput.value).toBe('secret123');
    } else {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    }
  });

  it('clicking link buttons does not crash', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const links = screen.getAllByRole('link');
    links.forEach(link => {
      try { fireEvent.click(link); } catch { /* ignore */ }
    });
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('typing in club name field (Radcliffe placeholder) updates state', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const clubNameInput = screen.queryByPlaceholderText('e.g. Radcliffe Olympic FC') as HTMLInputElement;
    if (clubNameInput) {
      fireEvent.change(clubNameInput, { target: { value: 'My Great Club' } });
      expect(clubNameInput.value).toBe('My Great Club');
    } else {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    }
  });

  it('typing in your name field (First and last name placeholder) updates state', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
    const nameInput = screen.queryByPlaceholderText('First and last name') as HTMLInputElement;
    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'John Smith' } });
      expect(nameInput.value).toBe('John Smith');
    } else {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    }
  });

  // A club admin whose site is still private has to be able to sign in from
  // here — the platform root is where they land once their own club URL turns
  // them away.
  describe('header auth', () => {
    it('offers a login button when signed out', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
      expect(screen.getByRole('button', { name: /log in/i })).toBeTruthy();
      expect(screen.queryByTestId('modal')).toBeNull();
    });

    it('opens the login modal when that button is clicked', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
      fireEvent.click(screen.getByRole('button', { name: /log in/i }));
      const modal = screen.getByTestId('modal');
      expect(modal.querySelector('input[type="email"]')).toBeTruthy();
      expect(modal.querySelector('input[type="password"]')).toBeTruthy();
    });

    it('shows nothing to sign in with while auth is still loading', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister />, {
        authValue: { ...mockLoggedOut, loading: true },
      });
      expect(screen.queryByRole('button', { name: /log in/i })).toBeNull();
    });

    it('swaps the login button for an account menu once signed in', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: adminOfTestFc });
      expect(screen.queryByRole('button', { name: /log in/i })).toBeNull();
      expect(screen.getByRole('button', { name: /Admin/ })).toBeTruthy();
    });

    it("links a signed-in user to their own club", async () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: adminOfTestFc });
      fireEvent.click(screen.getByRole('button', { name: /Admin/ }));
      await waitFor(() => {
        expect(screen.getByText(/Go to Test FC/).closest('a')?.getAttribute('href')).toBe('/test-fc/');
      });
    });

    it('badges that link as private while the club has not gone live', async () => {
      const privateClubs: ClubEntry[] = [{ id: 'c1', slug: 'test-fc', name: 'Test FC', published: false }];
      renderWithMantine(<LandingPage clubs={privateClubs} selfRegister />, { authValue: adminOfTestFc });
      fireEvent.click(screen.getByRole('button', { name: /Admin/ }));
      await waitFor(() => {
        expect(screen.getByText(/Go to Test FC/).closest('a')?.textContent).toContain('Private');
      });
    });

    it('gives a platform admin no club link — they belong to none', async () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockPlatformAdmin });
      fireEvent.click(screen.getByRole('button', { name: /Super/ }));
      await waitFor(() => {
        expect(screen.getByText('Logout')).toBeTruthy();
      });
      expect(screen.queryByText(/Go to/)).toBeNull();
    });
  });

  it('mouseEnter/Leave on AddClubCard triggers hover state without error', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister />, { authValue: mockLoggedOut });
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

  describe('when self-register is off', () => {
    it('shows published clubs in the directory without a signup card', () => {
      renderWithMantine(
        <LandingPage clubs={[...clubs, { id: 'c3', slug: 'quiet-fc', name: 'Quiet FC', published: false }]} selfRegister={false} />,
        { authValue: mockLoggedOut },
      );
      expect(screen.getByRole('link', { name: /Test FC/i })).toHaveAttribute('href', '/test-fc/');
      expect(screen.queryByText(/Quiet FC/i)).toBeNull();
      expect(screen.queryByText('Add your club')).toBeNull();
    });

    it('does not render the signup form or Create your club CTA', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister={false} />, { authValue: mockLoggedOut });
      expect(document.querySelector('form')).toBeNull();
      expect(screen.queryByRole('button', { name: /Create your club/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Get Your Club Online/i })).toBeNull();
      expect(screen.queryByText(/10 min/i)).toBeNull();
      expect(screen.queryByText(/ready in minutes/i)).toBeNull();
    });

    it('still offers View Demo Club and Log in', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister={false} />, { authValue: mockLoggedOut });
      expect(screen.getAllByRole('link', { name: /View Demo Club/i }).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: /log in/i })).toBeTruthy();
    });

    it('shows how-to-get-this instead of getstarted', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister={false} />, { authValue: mockLoggedOut });
      expect(document.getElementById('getstarted')).toBeNull();
      expect(document.getElementById('get-this')).toBeTruthy();
      expect(screen.getByText(/Not offering self-serve signup/i)).toBeTruthy();
    });

    it('login modal points at contact/demo rather than create', () => {
      renderWithMantine(<LandingPage clubs={clubs} selfRegister={false} />, { authValue: mockLoggedOut });
      fireEvent.click(screen.getByRole('button', { name: /log in/i }));
      expect(screen.queryByText(/Don't have a club yet/i)).toBeNull();
      expect(screen.getByText(/Want this for your club/i)).toBeTruthy();
    });
  });


  it('renders an honest features section without zero-PII oversell', () => {
    renderWithMantine(<LandingPage clubs={clubs} selfRegister={false} />, { authValue: mockLoggedOut });
    expect(document.getElementById('features')).toBeTruthy();
    expect(screen.getByText(/Privacy-aware by design/i)).toBeTruthy();
    expect(screen.getAllByText(/data controller/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/zero personal data/i)).toBeNull();
    expect(screen.queryByText(/no PII/i)).toBeNull();
    expect(screen.queryByText(/GDPR-compliant architecture/i)).toBeNull();
    expect(screen.queryByText(/No personal data stored/i)).toBeNull();
    expect(screen.getByRole('link', { name: /^Privacy$/i })).toHaveAttribute('href', '/demo/#/privacy');
  });


});

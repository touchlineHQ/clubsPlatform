import { render, type RenderOptions } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthContext, type AuthUser } from '../context/AuthContext';
import { ClubContext } from '../context/ClubContext';
import { SectionContext } from '../context/SectionContext';
import type { UserTeamRole, ClubEntry } from '../types';
import { vi } from 'vitest';

// ─── Standard context values ──────────────────────────────────────────────────

export const mockLoggedOut = {
  user: null as AuthUser | null,
  loading: false,
  isAdmin: false,
  isManager: false,
  isPlatformAdmin: false,
  teamRoles: [] as UserTeamRole[],
  refresh: vi.fn(async () => null as AuthUser | null),
};

export const mockMember = {
  ...mockLoggedOut,
  user: { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'member', clubSlug: 'test-club' },
};

export const mockAdmin = {
  ...mockLoggedOut,
  user: { id: 'u2', name: 'Admin', email: 'admin@example.com', role: 'admin', clubSlug: 'test-club' },
  isAdmin: true,
  isManager: true,
};

export const mockPlatformAdmin = {
  ...mockAdmin,
  user: { id: 'u3', name: 'Super', email: 'super@example.com', role: 'admin', clubSlug: null },
  isPlatformAdmin: true,
};

export const mockSingleClub = {
  clubSlug: 'test-club',
  isMultiClub: false,
  clubs: [] as ClubEntry[],
};

export const mockMultiClub = {
  clubSlug: 'test-club',
  isMultiClub: true,
  clubs: [
    { id: 'c1', slug: 'test-club', name: 'Test FC' },
    { id: 'c2', slug: 'other-club', name: 'Other FC' },
  ] as ClubEntry[],
};

export const mockSection = {
  activeSection: 'all',
  setActiveSection: vi.fn(),
};

// ─── renderWithProviders ──────────────────────────────────────────────────────

interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  authValue?: typeof mockLoggedOut;
  clubValue?: typeof mockSingleClub;
  sectionValue?: typeof mockSection;
  routerProps?: MemoryRouterProps;
}

export function renderWithProviders(
  ui: ReactNode,
  {
    authValue = mockLoggedOut,
    clubValue = mockSingleClub,
    sectionValue = mockSection,
    routerProps = {},
    ...renderOptions
  }: ProviderOptions = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider>
        <MemoryRouter {...routerProps}>
          <AuthContext.Provider value={authValue}>
            <ClubContext.Provider value={clubValue}>
              <SectionContext.Provider value={sectionValue}>
                {children}
              </SectionContext.Provider>
            </ClubContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>
      </MantineProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/**
 * Minimal wrapper for components that use Mantine but NOT react-router.
 * Avoids the dual-React conflict caused by website/node_modules/react-router
 * importing a different React copy than root react-dom.
 */
export function renderWithMantine(
  ui: ReactNode,
  {
    authValue = mockLoggedOut,
    clubValue = mockSingleClub,
    sectionValue = mockSection,
    ...renderOptions
  }: Omit<ProviderOptions, 'routerProps'> = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider>
        <AuthContext.Provider value={authValue}>
          <ClubContext.Provider value={clubValue}>
            <SectionContext.Provider value={sectionValue}>
              {children}
            </SectionContext.Provider>
          </ClubContext.Provider>
        </AuthContext.Provider>
      </MantineProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

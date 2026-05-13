import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { useAuth } from '../../context/AuthContext';
import { useClub } from '../../context/ClubContext';
import type { AuthUser } from '../../context/AuthContext';

// Mock routing — avoids pulling in react-router's bundled React copy.
vi.mock('react-router-dom', () => ({
  Navigate: vi.fn(() => null),
  useLocation: vi.fn(() => ({ pathname: '/protected', search: '', hash: '' })),
}));

vi.mock('@mantine/core', () => ({
  Center: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Loader: () => <div data-testid="loader" />,
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/ClubContext', () => ({ useClub: vi.fn() }));

const MockNavigate = vi.mocked(Navigate);
const mockUseAuth = vi.mocked(useAuth);
const mockUseClub = vi.mocked(useClub);

const baseAuth = {
  user: null as AuthUser | null,
  loading: false,
  isAdmin: false,
  isManager: false,
  isPlatformAdmin: false,
  teamRoles: [],
  refresh: vi.fn(),
};

const baseClub = { clubSlug: 'test-club', isMultiClub: false, clubs: [] };

const memberUser: AuthUser = {
  id: '1',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'member',
  clubSlug: 'test-club',
};

function setup(
  authOverrides: Partial<typeof baseAuth>,
  clubOverrides: Partial<typeof baseClub> = {},
  props: { requireAdmin?: boolean; requireManager?: boolean } = {},
) {
  mockUseAuth.mockReturnValue({ ...baseAuth, ...authOverrides });
  mockUseClub.mockReturnValue({ ...baseClub, ...clubOverrides });
  render(
    <ProtectedRoute {...props}>
      <div>protected-content</div>
    </ProtectedRoute>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loader while auth is loading', () => {
    setup({ loading: true });
    expect(screen.getByTestId('loader')).toBeInTheDocument();
    expect(screen.queryByText('protected-content')).not.toBeInTheDocument();
    expect(MockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to /login when unauthenticated', () => {
    setup({ user: null });
    expect(MockNavigate).toHaveBeenCalledOnce();
    const props = MockNavigate.mock.calls[0][0] as { to: string; replace: boolean };
    expect(props.to).toMatch(/^\/login\?redirectTo=/);
    expect(props.replace).toBe(true);
  });

  it('encodes the current path as redirectTo in the login URL', () => {
    setup({ user: null });
    const { to } = MockNavigate.mock.calls[0][0] as { to: string };
    expect(to).toBe('/login?redirectTo=%2Fprotected');
  });

  it('renders children when authenticated with no guards', () => {
    setup({ user: memberUser });
    expect(screen.getByText('protected-content')).toBeInTheDocument();
    expect(MockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to / when requireAdmin and user is not admin', () => {
    setup({ user: memberUser, isAdmin: false }, {}, { requireAdmin: true });
    expect(MockNavigate).toHaveBeenCalledOnce();
    const { to } = MockNavigate.mock.calls[0][0] as { to: string };
    expect(to).toBe('/');
  });

  it('renders children when requireAdmin and user is admin', () => {
    setup({ user: memberUser, isAdmin: true }, {}, { requireAdmin: true });
    expect(screen.getByText('protected-content')).toBeInTheDocument();
    expect(MockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to / when requireManager and user is a plain member', () => {
    setup({ user: memberUser, isAdmin: false, isManager: false }, {}, { requireManager: true });
    const { to } = MockNavigate.mock.calls[0][0] as { to: string };
    expect(to).toBe('/');
  });

  it('renders children when requireManager and user is manager', () => {
    setup({ user: memberUser, isAdmin: false, isManager: true }, {}, { requireManager: true });
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('renders children when requireManager and user is admin', () => {
    setup({ user: memberUser, isAdmin: true, isManager: true }, {}, { requireManager: true });
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('navigates to / when multi-club and user belongs to a different club', () => {
    setup(
      { user: { ...memberUser, clubSlug: 'other-club' }, isPlatformAdmin: false },
      { isMultiClub: true, clubSlug: 'test-club' },
    );
    const { to } = MockNavigate.mock.calls[0][0] as { to: string };
    expect(to).toBe('/');
  });

  it('renders children when multi-club and user is platform admin', () => {
    setup(
      { user: { ...memberUser, clubSlug: null }, isPlatformAdmin: true },
      { isMultiClub: true, clubSlug: 'test-club' },
    );
    expect(screen.getByText('protected-content')).toBeInTheDocument();
    expect(MockNavigate).not.toHaveBeenCalled();
  });

  it('renders children when multi-club and user club matches current club', () => {
    setup(
      { user: { ...memberUser, clubSlug: 'test-club' }, isPlatformAdmin: false },
      { isMultiClub: true, clubSlug: 'test-club' },
    );
    expect(screen.getByText('protected-content')).toBeInTheDocument();
    expect(MockNavigate).not.toHaveBeenCalled();
  });
});

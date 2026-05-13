import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import type { AuthUser } from '../../context/AuthContext';

function AuthDisplay() {
  const { user, loading, isAdmin, isManager, isPlatformAdmin, teamRoles } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div data-testid="user">{user ? user.name : 'none'}</div>
      <div data-testid="isAdmin">{String(isAdmin)}</div>
      <div data-testid="isManager">{String(isManager)}</div>
      <div data-testid="isPlatformAdmin">{String(isPlatformAdmin)}</div>
      <div data-testid="teamCount">{teamRoles.length}</div>
    </div>
  );
}

function RefreshButton() {
  const { refresh } = useAuth();
  return <button onClick={() => refresh()}>refresh</button>;
}

function meResponse(user: AuthUser) {
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function teamsResponse(count = 0) {
  const teams = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    teamSlug: `team-${i}`,
    teamLeague: 'League A',
    teamName: `Team ${i}`,
    role: 'manager' as const,
  }));
  return new Response(JSON.stringify({ teams }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const memberUser: AuthUser = {
  id: '1',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'member',
  clubSlug: 'test-club',
};

const adminUser: AuthUser = {
  id: '2',
  name: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  clubSlug: 'test-club',
};

const platformAdminUser: AuthUser = {
  id: '3',
  name: 'SuperAdmin',
  email: 'super@example.com',
  role: 'admin',
  clubSlug: null,
};

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state before fetch completes', () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}));
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('sets user and loading=false after successful /api/me', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/me' ? meResponse(memberUser) : teamsResponse(),
    );
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Alice'));
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
  });

  it('isAdmin=false and isManager=false for a member role', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/me' ? meResponse(memberUser) : teamsResponse(),
    );
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('isAdmin')).toHaveTextContent('false'));
    expect(screen.getByTestId('isManager')).toHaveTextContent('false');
    expect(screen.getByTestId('isPlatformAdmin')).toHaveTextContent('false');
  });

  it('isAdmin=true and isManager=true for admin role', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/me' ? meResponse(adminUser) : teamsResponse(),
    );
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('isAdmin')).toHaveTextContent('true'));
    expect(screen.getByTestId('isManager')).toHaveTextContent('true');
    expect(screen.getByTestId('isPlatformAdmin')).toHaveTextContent('false');
  });

  it('isPlatformAdmin=true for admin with null clubSlug', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/me' ? meResponse(platformAdminUser) : teamsResponse(),
    );
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('isPlatformAdmin')).toHaveTextContent('true'));
  });

  it('user=null when /api/me returns non-ok', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/me'
        ? new Response(null, { status: 401 })
        : teamsResponse(),
    );
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
  });

  it('loads teamRoles from /api/my-teams', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/me' ? meResponse(memberUser) : teamsResponse(2),
    );
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('teamCount')).toHaveTextContent('2'));
  });

  it('teamRoles=[] when /api/my-teams fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === '/api/me'
        ? meResponse(memberUser)
        : new Response(null, { status: 500 }),
    );
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('teamCount')).toHaveTextContent('0'));
  });

  it('user=null and loading=false after a fetch network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));
    render(<AuthProvider><AuthDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
  });

  it('refresh() updates user state on subsequent call', async () => {
    let phase = 'initial';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url) === '/api/me') {
        return phase === 'initial'
          ? new Response(null, { status: 401 })
          : meResponse(memberUser);
      }
      return teamsResponse();
    });

    render(
      <AuthProvider>
        <AuthDisplay />
        <RefreshButton />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));

    phase = 'refresh';
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Alice'));
  });
});

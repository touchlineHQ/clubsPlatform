import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserTeamRole } from '../types';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  clubSlug: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  /** True when the user is an admin with no specific clubSlug — can manage all clubs. */
  isPlatformAdmin: boolean;
  teamRoles: UserTeamRole[];
  refresh: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isAdmin: false,
  isManager: false,
  isPlatformAdmin: false,
  teamRoles: [],
  refresh: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamRoles, setTeamRoles] = useState<UserTeamRole[]>([]);

  const refresh = async (): Promise<AuthUser | null> => {
    try {
      const [meRes, teamsRes] = await Promise.all([
        fetch('/api/me'),
        fetch('/api/my-teams'),
      ]);

      if (!meRes.ok) {
        setUser(null);
        setTeamRoles([]);
        return null;
      }

      const data = await meRes.json() as { user: AuthUser };
      setUser(data.user);

      if (teamsRes.ok) {
        const teamData = await teamsRes.json() as { teams: UserTeamRole[] };
        setTeamRoles(teamData.teams ?? []);
      } else {
        setTeamRoles([]);
      }

      return data.user;
    } catch {
      setUser(null);
      setTeamRoles([]);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isAdmin: user?.role === 'admin',
      isManager: user?.role === 'manager' || user?.role === 'admin',
      isPlatformAdmin: user?.role === 'admin' && user?.clubSlug === null,
      teamRoles,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

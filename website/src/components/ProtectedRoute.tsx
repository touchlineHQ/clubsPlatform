import { Navigate, useLocation } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import { useClub } from '../context/ClubContext';
import type { ReactNode } from 'react';
import type { Permission } from '../lib/permissions';

interface Props {
  children: ReactNode;
  requireAdmin?: boolean;
  requireManager?: boolean;
  /** Committee permission(s) the route needs; any one is enough (#79). */
  permission?: Permission | readonly Permission[];
}

export function ProtectedRoute({ children, requireAdmin, requireManager, permission }: Props) {
  const { user, loading, isAdmin, isManager, isPlatformAdmin, can } = useAuth();
  const { clubSlug, isMultiClub } = useClub();
  const location = useLocation();

  if (loading) {
    return <Center h={200}><Loader /></Center>;
  }

  if (!user) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    const loginPath = `/login?redirectTo=${encodeURIComponent(target)}`;
    return <Navigate to={loginPath} replace />;
  }

  // In multi-club mode, prevent users from accessing protected routes of other clubs.
  // Platform admins (clubSlug === null) are allowed everywhere.
  if (isMultiClub && !isPlatformAdmin && user.clubSlug !== clubSlug) {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (permission && !can(permission)) {
    return <Navigate to="/" replace />;
  }

  if (requireManager && !isManager && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

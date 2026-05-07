import { Navigate, useLocation } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import { useAuth } from '../context/AuthContext';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  requireAdmin?: boolean;
  requireManager?: boolean;
}

export function ProtectedRoute({ children, requireAdmin, requireManager }: Props) {
  const { user, loading, isAdmin, isManager } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Center h={200}><Loader /></Center>;
  }

  if (!user) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    const loginPath = `/login?redirectTo=${encodeURIComponent(target)}`;
    return <Navigate to={loginPath} replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (requireManager && !isManager && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

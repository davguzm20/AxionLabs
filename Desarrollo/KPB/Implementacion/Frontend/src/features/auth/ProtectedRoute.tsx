import { Navigate, Outlet, useLocation } from 'react-router-dom';

export function ProtectedRoute() {
  const location = useLocation();
  if (!localStorage.getItem('access_token')) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

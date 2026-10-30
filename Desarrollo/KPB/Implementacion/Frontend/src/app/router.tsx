import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/inicio" replace />,
  },
  {
    element: <AppShell />,
    children: [
      { path: '/inicio', element: <PlaceholderPage title="Inicio" /> },
      { path: '/historial', element: <PlaceholderPage title="Historial" /> },
      { path: '/monederos', element: <PlaceholderPage title="Monederos" /> },
      { path: '/ajustes', element: <PlaceholderPage title="Ajustes" /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

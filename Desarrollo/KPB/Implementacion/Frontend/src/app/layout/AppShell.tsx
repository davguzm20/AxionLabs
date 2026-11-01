import { Outlet } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { NotificationStreamProvider } from '../../features/notifications/hooks/useNotificationStream';

export function AppShell() {
  const { pathname } = useLocation();
  const isFormRoute = /^\/(monederos|presupuestos)\/(nuevo|[^/]+\/editar)$/.test(pathname)
    || /^\/ajustes\/(perfil|password|categorias)$/.test(pathname);

  return (
    <NotificationStreamProvider>
      <div className="h-dvh w-full overflow-hidden bg-white text-ink-900 lg:flex">
        <Sidebar />
        <main className="h-full min-w-0 w-full flex-1 overflow-hidden bg-white">
          <Outlet />
        </main>
        {!isFormRoute && <BottomNav />}
      </div>
    </NotificationStreamProvider>
  );
}

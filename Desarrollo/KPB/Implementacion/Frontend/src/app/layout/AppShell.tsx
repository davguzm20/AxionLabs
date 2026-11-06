import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { NotificationBell } from '../../features/cu08/components/NotificationBell';
import { NotificationStreamProvider } from '../../features/notifications/hooks/useNotificationStream';

export function AppShell() {
  const { pathname } = useLocation();
  const isFormRoute = /^\/(monederos|presupuestos)\/(nuevo|[^/]+\/editar)$/.test(pathname)
    || /^\/ajustes\/(perfil|password|categorias)$/.test(pathname);

  return (
    <NotificationStreamProvider>
      <div className="relative h-dvh w-full overflow-hidden bg-white text-ink-900 lg:flex">
        <Sidebar />
        <main className="h-full min-w-0 w-full flex-1 overflow-hidden bg-white">
          <Outlet />
        </main>
        {!isFormRoute && <BottomNav />}
        {pathname !== '/ajustes' && pathname !== '/presupuestos' && (
          <div className="fixed right-4 top-2 z-30 rounded-xl bg-white/95 shadow-sm backdrop-blur">
            <NotificationBell />
          </div>
        )}
      </div>
    </NotificationStreamProvider>
  );
}

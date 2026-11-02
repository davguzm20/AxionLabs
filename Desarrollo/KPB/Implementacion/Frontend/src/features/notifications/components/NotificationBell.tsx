import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUnreadNotificationCount } from '../hooks/useNotifications';

export function NotificationBell() {
  const { data: unreadCount = 0 } = useUnreadNotificationCount();

  return (
    <Link
      to="/notificaciones"
      aria-label={unreadCount > 0 ? `Notificaciones, ${unreadCount} sin leer` : 'Notificaciones'}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-600 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <Bell aria-hidden="true" size={22} />
      {unreadCount > 0 && (
        <span aria-hidden="true" className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-600 px-1 text-[0.65rem] font-semibold leading-none text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

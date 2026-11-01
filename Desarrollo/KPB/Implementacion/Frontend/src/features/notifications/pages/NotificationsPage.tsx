import { useState } from 'react';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNotifications, useUnreadNotificationCount } from '../hooks/useNotifications';
import { useNotificationStreamStatus } from '../hooks/useNotificationStream';
import type { NotificationStatus, UserNotification } from '../types/notification.types';

type Filter = 'ALL' | 'UNREAD';

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const differenceSeconds = Math.round((date.getTime() - Date.now()) / 1_000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
    ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1],
  ];
  const formatter = new Intl.RelativeTimeFormat('es-PE', { numeric: 'auto' });
  const [unit, secondsPerUnit] = units.find(([, seconds]) => Math.abs(differenceSeconds) >= seconds) ?? units.at(-1)!;
  return formatter.format(Math.round(differenceSeconds / secondsPerUnit), unit);
}

function NotificationItem({
  notification,
  onRead,
  disabled,
}: {
  notification: UserNotification;
  onRead: (id: string) => void;
  disabled: boolean;
}) {
  const unread = notification.status === 'UNREAD';
  return (
    <li className={`flex items-start gap-3 rounded-xl border bg-white p-4 shadow-sm ${unread ? 'border-brand-200' : 'border-ink-200'}`}>
      <Bell aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600" size={20} />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-ink-900">{notification.title}</h2>
        <p className="mt-1 text-sm leading-5 text-ink-700">{notification.body}</p>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-500">
          <time dateTime={notification.created_at}>{formatRelativeDate(notification.created_at)}</time>
          {unread ? <span className="font-medium text-brand-700">No leída</span> : <span>Leída</span>}
        </div>
      </div>
      {unread && (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Marcar como leída: ${notification.title}`}
          onClick={() => onRead(notification.id)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          <CheckCheck aria-hidden="true" size={19} />
        </button>
      )}
      {unread && <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full bg-brand-600" />}
    </li>
  );
}

export function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const status: NotificationStatus | undefined = filter === 'UNREAD' ? 'UNREAD' : undefined;
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const {
    notifications,
    total,
    pages,
    isLoading,
    error,
    refetch,
    markRead,
    isMarkingRead,
    actionError,
    markAllRead,
    isMarkingAllRead,
  } = useNotifications(status, page);
  const streamStatus = useNotificationStreamStatus();
  const hasUnread = unreadCount > 0;

  return (
    <main className="h-full w-full overflow-y-auto bg-gray-50 px-4 pb-24 sm:px-6 lg:pb-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="sticky top-0 z-10 -mx-4 mb-4 flex min-h-[4.5rem] items-center gap-3 border-b border-ink-200 bg-white px-4 sm:-mx-6 sm:px-6">
          <Link to="/inicio" aria-label="Volver al inicio" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-bg">
            <ArrowLeft aria-hidden="true" size={22} />
          </Link>
          <h1 className="flex-1 font-semibold text-ink-900">Notificaciones</h1>
          <button
            type="button"
            disabled={!hasUnread || isMarkingAllRead}
            onClick={() => void markAllRead().catch(() => undefined)}
            className="min-h-11 rounded-md px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-400"
          >
            Marcar todas como leídas
          </button>
        </header>

        <div className="mb-4 flex gap-2" role="group" aria-label="Filtrar notificaciones">
          {(['ALL', 'UNREAD'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              className={`min-h-11 rounded-full px-4 text-sm font-medium ${filter === value ? 'bg-brand-600 text-white' : 'bg-white text-ink-700 hover:bg-bg'}`}
            >
              {value === 'ALL' ? 'Todas' : 'No leídas'}
            </button>
          ))}
          {filter === 'ALL' && total > 0 && <span className="sr-only">{total} notificaciones</span>}
        </div>

        {streamStatus === 'reconnecting' && (
          <p role="status" className="mb-3 text-sm text-ink-500">Reconectando…</p>
        )}

        {isLoading ? (
          <div role="status" aria-label="Cargando notificaciones" className="space-y-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-white shadow-sm" />)}
          </div>
        ) : error ? (
          <section role="alert" className="rounded-xl border border-danger-300 bg-white p-5">
            <p className="text-sm text-danger-700">No pudimos cargar tus notificaciones.</p>
            <button type="button" onClick={() => void refetch()} className="mt-3 min-h-11 rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">Reintentar</button>
          </section>
        ) : notifications.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-ink-600">
            {filter === 'UNREAD' ? 'Estás al día.' : 'No tienes notificaciones.'}
          </p>
        ) : (
          <ul role="list" aria-live="polite" className="space-y-3">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                disabled={isMarkingRead || isMarkingAllRead}
                onRead={(id) => void markRead(id).catch(() => undefined)}
              />
            ))}
          </ul>
        )}
        {actionError && <p role="alert" className="mt-3 rounded-lg border border-danger-300 bg-white p-3 text-sm text-danger-700">No se pudo actualizar la notificación. Inténtalo de nuevo.</p>}
        {!isLoading && !error && pages > 1 && (
          <nav aria-label="Paginación de notificaciones" className="mt-5 flex items-center justify-between gap-3">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-11 rounded-md border border-ink-300 bg-white px-4 text-sm font-medium disabled:opacity-50">Anterior</button>
            <span className="text-sm text-ink-600">Página {page} de {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))} className="min-h-11 rounded-md border border-ink-300 bg-white px-4 text-sm font-medium disabled:opacity-50">Siguiente</button>
          </nav>
        )}
      </div>
    </main>
  );
}

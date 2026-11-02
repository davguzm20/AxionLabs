import { AlertTriangle, Bell, Info, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import type { Notification } from '../types/alert.types';

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function NotificationItem({ item, onOpen }: { item: Notification; onOpen: (item: Notification) => void }) {
  const Icon = item.priority === 'high' ? AlertTriangle : Info;
  return (
    <button type="button" onClick={() => onOpen(item)} className="flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50">
      <Icon aria-hidden="true" size={19} className={`mt-0.5 shrink-0 ${item.priority === 'high' ? 'text-red-600' : 'text-teal-700'}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5 text-gray-800">{item.message}</span>
        <span className="mt-1 block text-xs text-gray-500">{dateLabel(item.createdAt)}</span>
      </span>
      {!item.read && <span aria-label="No leída" className="mt-2 size-2 shrink-0 rounded-full bg-teal-600" />}
    </button>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, loading, error, refresh, markRead, loadMore, hasMore } = useNotifications();

  const openNotification = async (item: Notification) => {
    if (!item.read) {
      try { await markRead(item.id); } catch { /* La siguiente actualización mantiene el estado del servidor. */ }
    }
  };

  return (
    <div className="relative">
      <button type="button" aria-label={`Notificaciones${unreadCount ? `, ${unreadCount} no leídas` : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative flex size-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-teal-700">
        <Bell aria-hidden="true" size={21} />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && <section aria-label="Notificaciones recientes" className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Notificaciones</h2>
          <button
            type="button"
            aria-label="Actualizar notificaciones"
            title="Actualizar notificaciones"
            onClick={() => void refresh()}
            className="grid size-9 place-items-center rounded-full text-teal-700 transition-colors hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            <RefreshCw aria-hidden="true" size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>
        {error ? <div className="p-4"><p role="alert" className="text-sm text-red-700">{error}</p></div> : loading && notifications.length === 0 ? <p role="status" className="p-5 text-center text-sm text-gray-500">Cargando…</p> : notifications.length === 0 ? <p className="p-5 text-center text-sm text-gray-500">Estás al día.</p> : <div className="max-h-[65dvh] overflow-y-auto">{notifications.map((item) => <NotificationItem key={item.id} item={item} onOpen={(selected) => void openNotification(selected)} />)}{hasMore && <button type="button" onClick={() => void loadMore()} className="min-h-11 w-full text-sm font-medium text-teal-700 hover:bg-gray-50">Cargar más</button>}</div>}
      </section>}
    </div>
  );
}

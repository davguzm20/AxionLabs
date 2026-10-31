import { useCallback, useEffect, useState } from 'react';
import { getNotifications, markNotificationRead } from '../services/notificationService';
import type { Notification } from '../types/alert.types';

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [result, unreadResult] = await Promise.all([
        getNotifications({ page: 1, pageSize: 10 }, signal),
        getNotifications({ page: 1, pageSize: 1, unread: true }, signal),
      ]);
      setNotifications((current) => {
        const incomingIds = new Set(result.data.map((item) => item.id));
        const recent = current.filter((item) => !incomingIds.has(item.id));
        return [...recent, ...result.data];
      });
      setPage(1);
      setPages(result.pagination.pages);
      setUnreadCount(unreadResult.pagination.total);
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las notificaciones.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const loadMore = async () => {
    if (page >= pages) return;
    try {
      const nextPage = page + 1;
      const result = await getNotifications({ page: nextPage, pageSize: 10 });
      setNotifications((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.data.filter((item) => !known.has(item.id))];
      });
      setPage(nextPage);
      setPages(result.pagination.pages);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar más notificaciones.');
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  const markRead = async (id: string) => {
    await markNotificationRead(id);
    const wasUnread = notifications.some((item) => item.id === id && !item.read);
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
    if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
  };

  return {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    markRead,
    loadMore,
    hasMore: page < pages,
  };
}

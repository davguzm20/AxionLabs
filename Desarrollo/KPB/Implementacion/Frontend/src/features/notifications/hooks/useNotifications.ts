import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService';
import type { NotificationStatus } from '../types/notification.types';

export const notificationsQueryKey = ['notifications'] as const;

function notificationPagination(response: Awaited<ReturnType<typeof listNotifications>>) {
  if ('pagination' in response) return { total: response.pagination.total_items, pages: response.pagination.total_pages };
  return { total: response.meta.total, pages: response.meta.pages };
}

export function useNotifications(status?: NotificationStatus, page = 1) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...notificationsQueryKey, status ?? 'ALL', page],
    queryFn: ({ signal }) => listNotifications({ status, page }, signal),
  });

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
  });
  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsQueryKey }),
  });

  return {
    notifications: query.data?.data ?? [],
    total: query.data ? notificationPagination(query.data).total : 0,
    pages: query.data ? notificationPagination(query.data).pages : 0,
    isLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    markRead: markRead.mutateAsync,
    isMarkingRead: markRead.isPending,
    actionError: markRead.error ?? markAllRead.error,
    markAllRead: markAllRead.mutateAsync,
    isMarkingAllRead: markAllRead.isPending,
  };
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: [...notificationsQueryKey, 'UNREAD', 'count'],
    queryFn: ({ signal }) => listNotifications({ status: 'UNREAD', page: 1, pageSize: 1 }, signal),
    select: (response) => notificationPagination(response).total,
  });
}

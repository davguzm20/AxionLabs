import { api } from '../../../lib/api';
import type {
  NotificationListResponse,
  ApiNotification,
  NotificationStatus,
  UserNotification,
  UserPreferences,
} from '../types/notification.types';

interface ApiNotificationListResponse {
  data: ApiNotification[];
  pagination: { page: number; page_size: number; total_items: number; total_pages: number };
}

export interface NotificationFilters {
  page?: number;
  pageSize?: number;
  status?: NotificationStatus;
  type?: ApiNotification['type'];
}

export async function listNotifications(
  filters: NotificationFilters = {},
  signal?: AbortSignal,
): Promise<NotificationListResponse> {
  const query = new URLSearchParams({
    page: String(filters.page ?? 1),
    page_size: String(filters.pageSize ?? 20),
  });
  query.set('type', filters.type ?? 'budget_alert');
  if (filters.status) query.set('unread', String(filters.status === 'UNREAD'));
  const response = await api<ApiNotificationListResponse>(`/notifications?${query.toString()}`, { signal });
  return {
    ...response,
    data: response.data.map((notification) => ({
      id: notification.id,
      type: 'BUDGET_ALERT',
      title: 'Alerta de presupuesto',
      body: notification.message,
      status: notification.read ? 'READ' : 'UNREAD',
      alert_id: null,
      created_at: notification.created_at,
      read_at: null,
    })),
  };
}

export function markNotificationRead(id: string): Promise<void | UserNotification> {
  return api<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead(): Promise<{ message: string }> {
  return api<{ message: string }>('/notifications/read-all', { method: 'PATCH' });
}

export function getUserPreferences(signal?: AbortSignal): Promise<UserPreferences> {
  return api<UserPreferences>('/users/me/preferences', { signal });
}

export function updateEmailNotificationPreference(enabled: boolean): Promise<UserPreferences> {
  return api<UserPreferences>('/users/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ email_notifications: enabled }),
  });
}

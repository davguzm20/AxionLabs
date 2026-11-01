import { api } from '../../../lib/api';
import type {
  NotificationListResponse,
  NotificationStatus,
  UserNotification,
  UserPreferences,
} from '../types/notification.types';

export interface NotificationFilters {
  page?: number;
  pageSize?: number;
  status?: NotificationStatus;
}

export function listNotifications(
  filters: NotificationFilters = {},
  signal?: AbortSignal,
): Promise<NotificationListResponse> {
  const query = new URLSearchParams({
    page: String(filters.page ?? 1),
    page_size: String(filters.pageSize ?? 20),
  });
  if (filters.status) query.set('status', filters.status);
  return api<NotificationListResponse>(`/notifications?${query.toString()}`, { signal });
}

export function markNotificationRead(id: string): Promise<UserNotification> {
  return api<UserNotification>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
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

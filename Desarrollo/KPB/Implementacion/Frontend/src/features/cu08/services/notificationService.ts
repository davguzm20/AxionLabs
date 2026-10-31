import type { Notification, NotificationPage } from '../types/alert.types';

const API = '/api/v1';

interface NotificationDto {
  id: string;
  type: string;
  priority: 'normal' | 'high';
  category: { id: string; name: string };
  threshold_percentage: number;
  usage_percentage: number;
  spent_month: string;
  monthly_limit: string;
  remaining: string;
  message: string;
  read: boolean;
  created_at: string;
}

interface NotificationPageDto {
  data: NotificationDto[];
  pagination: NotificationPage['pagination'];
}

function fromDto(dto: NotificationDto): Notification {
  return {
    id: dto.id,
    type: dto.type,
    priority: dto.priority,
    category: dto.category,
    thresholdPercentage: dto.threshold_percentage,
    usagePercentage: dto.usage_percentage,
    spentMonth: dto.spent_month,
    monthlyLimit: dto.monthly_limit,
    remaining: dto.remaining,
    message: dto.message,
    read: dto.read,
    createdAt: dto.created_at,
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(body?.error?.message ?? body?.message ?? 'No se pudieron cargar las notificaciones.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getNotifications(options: {
  page?: number;
  pageSize?: number;
  unread?: boolean;
}, signal?: AbortSignal): Promise<NotificationPage> {
  const params = new URLSearchParams({ type: 'budget_alert', page: String(options.page ?? 1), page_size: String(options.pageSize ?? 10) });
  if (options.unread !== undefined) params.set('unread', String(options.unread));
  const result = await request<NotificationPageDto>(`${API}/notifications?${params}`, { signal });
  return { ...result, data: result.data.map(fromDto) };
}

export function markNotificationRead(notificationId: string): Promise<void> {
  return request<void>(`${API}/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' });
}

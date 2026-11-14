export type NotificationStatus = 'UNREAD' | 'READ';

export interface UserNotification {
  id: string;
  type: 'BUDGET_ALERT';
  title: string;
  body: string;
  status: NotificationStatus;
  alert_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationListResponse {
  data: UserNotification[];
  meta: {
    page: number;
    page_size: number;
    total: number;
    pages: number;
  };
}

export interface UserPreferences {
  main_currency: 'PEN' | 'USD';
  email_notifications: boolean;
}

export interface NotificationStreamEvent {
  event: 'alert.created' | 'notification.read';
  data: Record<string, unknown>;
}

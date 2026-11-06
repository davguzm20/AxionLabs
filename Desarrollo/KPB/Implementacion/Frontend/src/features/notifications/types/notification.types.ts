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

export interface ApiNotification {
  id: string;
  type: 'budget_alert';
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

export interface ContractNotificationListResponse {
  data: UserNotification[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
}

export interface LegacyNotificationListResponse {
  data: UserNotification[];
  meta: { page: number; page_size: number; total: number; pages: number };
}

export type NotificationListResponse = ContractNotificationListResponse | LegacyNotificationListResponse;

export interface UserPreferences {
  main_currency: 'PEN' | 'USD';
  email_notifications: boolean;
}

export interface NotificationStreamEvent {
  event: 'budget_alert';
  data: Record<string, unknown>;
}

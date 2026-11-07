export interface AlertThreshold {
  categoryId: string;
  thresholds: number[];
  channels: string[];
  isDefault: boolean;
}

export interface Notification {
  id: string;
  type: string;
  priority: 'normal' | 'high';
  category: { id: string; name: string };
  thresholdPercentage: number;
  usagePercentage: number;
  spentMonth: string;
  monthlyLimit: string;
  remaining: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  data: Notification[];
  pagination: { page: number; page_size: number; total_items: number; total_pages: number };
}

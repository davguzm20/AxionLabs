export interface Category {
  id: string;
  name: string;
  currency: string;
  type?: 'EXPENSE' | 'INCOME';
}

export interface AlertThreshold {
  percentage: number;
}

export interface Budget {
  category_id: string;
  category_name: string;
  currency: string;
  monthly_limit: string | null;
  spent: string;
  usage_percentage: number;
  alert_threshold: number;
}

export interface BudgetsResponse {
  period: string;
  data: Budget[];
}

export interface BudgetUpsertPayload {
  monthly_limit: string;
}

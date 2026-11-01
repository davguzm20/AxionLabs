export type Currency = 'PEN' | 'USD';
export type BudgetPeriodType = 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
export type BudgetStatus = 'ACTIVE' | 'INACTIVE';

export interface Category {
  id: string;
  name: string;
  type?: 'EXPENSE' | 'INCOME';
  icon: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface BudgetThreshold {
  id: string;
  percentage: number;
  triggered: boolean;
}

export interface Budget {
  id: string;
  category: Category;
  currency: Currency;
  amount: string;
  period_type: BudgetPeriodType;
  start_date: string | null;
  period_days: number | null;
  period_start: string;
  period_end: string;
  consumed: string;
  remaining: string;
  percentage: number;
  status: BudgetStatus;
  thresholds: BudgetThreshold[];
}

export interface BudgetListResponse {
  data: Budget[];
}

export interface CategoryListResponse {
  data: Category[];
}

export interface BudgetCreatePayload {
  category_id: string;
  currency: Currency;
  amount: string;
  period_type: BudgetPeriodType;
  start_date: string | null;
  period_days: number | null;
  thresholds?: number[];
}

export interface BudgetUpdatePayload {
  amount: string;
  period_type: BudgetPeriodType;
  start_date: string | null;
  period_days: number | null;
}

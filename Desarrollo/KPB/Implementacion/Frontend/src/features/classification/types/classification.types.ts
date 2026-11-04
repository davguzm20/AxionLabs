export type TransactionType = 'EXPENSE' | 'INCOME';

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
}

export interface ApiCategory {
  id: string;
  name: string;
  type: 'expense' | 'income';
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: string;
  currency: string;
  concept: string;
  category?: Category;
}

export interface ClassificationRequest {
  concept: string;
  amount: string;
}

export interface ClassificationResponse {
  category: Category;
  confidence: number;
  reason: string;
  needs_review: boolean;
}

export interface CategoriesResponse {
  data: ApiCategory[];
}

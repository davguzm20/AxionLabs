export type TransactionType = 'EXPENSE' | 'INCOME';

export type CategoryChoice = {
  id: string;
  name: string;
  icon?: string;
  type?: TransactionType;
  status?: string;
};

export type ApiCategoryChoice = {
  id: string;
  name: string;
  type: 'expense' | 'income';
};

export type WalletChoice = {
  id: string;
  name: string;
  currency: string;
  is_default?: boolean;
  status?: string;
};

export type TransactionDraft = {
  type: TransactionType;
  amount: string;
  currency: string;
  concept: string;
  transaction_date: string;
  category_id: string;
  wallet_id: string;
  merchant?: string | null;
  ruc?: string | null;
};

export type BudgetAlert = {
  notification_id: string;
  category: { id: string; name: string };
  threshold_percentage: number;
  usage_percentage: number;
  remaining: string;
  priority: 'normal' | 'high';
  message: string;
};

export type LegacyBudgetAlert = {
  id?: string;
  title?: string;
  message: string;
  body?: string;
  severity?: 'warning' | 'danger';
  priority?: 'normal' | 'high' | 'NORMAL' | 'HIGH';
  threshold_percentage?: number;
  usage_percentage?: number;
};

export interface Api10SavedTransaction {
  id: string;
  type: 'expense' | 'income';
  amount: string;
  currency: string;
  concept: string;
  category: { id: string; name: string; source: string };
  wallet: { id: string; name: string };
  occurred_at: string;
  source: string;
}

export interface Api10SavedTransactionResponse {
  transaction: Api10SavedTransaction;
  confirmation_message: string;
  balances: {
    wallet: { id: string; balance: string };
    category: { id: string; spent_month: string };
  };
  budget_alert: BudgetAlert | null;
}

export type TransactionPreview = {
  preview_id: string;
  transcript?: string;
  ocr_text?: string;
  wallet_id?: string | null;
  extracted: {
    type: TransactionType;
    amount: string | null;
    currency: string;
    concept: string;
    merchant?: string | null;
    ruc?: string | null;
    transaction_date: string;
    wallet_id?: string | null;
    category: CategoryChoice;
  };
  confidence: number;
  requires_confirmation: true;
};

export type SavedTransactionResponse = {
  transaction: {
    id: string;
    type: TransactionType;
    amount: string;
    currency: string;
    concept: string;
    transaction_date: string;
    wallet_id: string;
    category: CategoryChoice;
  };
  wallet_name?: string;
  alerts?: LegacyBudgetAlert[];
  budget_alert?: LegacyBudgetAlert | null;
};

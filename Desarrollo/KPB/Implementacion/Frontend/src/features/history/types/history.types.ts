export type HistoryTransactionType = 'EXPENSE' | 'INCOME';
export type HistoryTransactionSource = 'TEXT' | 'MANUAL' | 'VOICE' | 'RECEIPT';

export interface HistoryCategory {
  id: string;
  name: string;
  icon: string;
  type?: HistoryTransactionType;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface HistoryTransaction {
  id: string;
  type: HistoryTransactionType;
  amount: string;
  currency: string;
  concept: string;
  merchant?: string | null;
  ruc?: string | null;
  transaction_date: string;
  wallet_id: string;
  category: HistoryCategory;
  source: HistoryTransactionSource;
  needs_review?: boolean;
  category_confidence?: number | null;
  transcript?: string | null;
  ocr_text?: string | null;
  created_at?: string;
}

export interface HistoryFilters {
  date_from: string;
  date_to: string;
  type?: HistoryTransactionType;
  category_id?: string;
  wallet_id?: string;
  q?: string;
}

export interface HistoryListResponse {
  data: HistoryTransaction[];
  meta: { page: number; page_size: number; total: number; pages: number };
}

export interface HistorySummaryResponse {
  date_from: string;
  date_to: string;
  count: number;
  by_currency: Array<{ currency: string; income: string; expense: string; net: string }>;
}

export interface TransactionCorrection {
  category_id?: string;
  concept?: string;
}

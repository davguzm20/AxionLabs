export type TransactionType = 'EXPENSE' | 'INCOME';

export type CategoryChoice = {
  id: string;
  name: string;
  icon?: string;
  type: TransactionType;
  status?: string;
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
  alerts?: Array<{ message: string; severity: 'warning' | 'danger' }>;
};

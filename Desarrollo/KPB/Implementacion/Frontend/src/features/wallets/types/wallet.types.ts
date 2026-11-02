export type WalletType = 'bank' | 'cash';
export type WalletStatus = 'ACTIVE' | 'INACTIVE';
export type WalletCurrency = 'PEN' | 'USD';

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  currency: WalletCurrency;
  balance: string;
  initial_balance?: string;
  is_default: boolean;
  status?: WalletStatus;
  has_transactions?: boolean;
  transaction_count?: number;
}

export interface CreateWalletPayload {
  name: string;
  type: WalletType;
  currency: WalletCurrency;
  initial_balance: string;
}

export interface CreateWalletResponse {
  wallet: Wallet;
  confirmation_message: string;
}

export interface WalletListResponse {
  data: Wallet[];
}

export interface UpdateWalletPayload {
  name?: string;
  type?: WalletType;
  currency?: WalletCurrency;
  status?: WalletStatus;
}

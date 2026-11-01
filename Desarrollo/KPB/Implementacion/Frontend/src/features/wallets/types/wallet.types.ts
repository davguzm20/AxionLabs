export type WalletType = 'bank' | 'cash';

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  currency: string;
  balance: string;
  initial_balance?: string;
  is_default: boolean;
}

export interface CreateWalletPayload {
  name: string;
  type: WalletType;
  currency: string;
  initial_balance: string;
}

export interface CreateWalletResponse {
  wallet: Wallet;
  confirmation_message: string;
}

export interface WalletListResponse {
  data: Wallet[];
}

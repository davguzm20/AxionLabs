export type WalletType = 'bank' | 'cash';

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  currency: string;
  balance: string;
  is_default: boolean;
}

export interface CreateWalletPayload {
  name: string;
  type: WalletType;
  currency: string;
  balance: string;
}

export interface UpdateWalletPayload {
  name: string;
  balance: string;
}

export interface WalletListResponse {
  data: Wallet[];
}

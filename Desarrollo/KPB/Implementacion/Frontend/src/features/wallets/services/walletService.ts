import { api } from '../../../lib/api';
import type {
  CreateWalletPayload,
  CreateWalletResponse,
  Wallet,
  WalletListResponse,
} from '../types/wallet.types';

export async function getWallets(signal?: AbortSignal): Promise<Wallet[]> {
  const result = await api<WalletListResponse>('/wallets', { signal });
  return result.data;
}

export async function createWallet(payload: CreateWalletPayload): Promise<CreateWalletResponse> {
  return api<CreateWalletResponse>('/wallets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

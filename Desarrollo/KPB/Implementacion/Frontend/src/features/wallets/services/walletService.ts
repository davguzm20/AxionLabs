import { api } from '../../../lib/api';
import type {
  CreateWalletPayload,
  CreateWalletResponse,
  Wallet,
  UpdateWalletPayload,
} from '../types/wallet.types';

type ApiWallet = Omit<Wallet, 'type' | 'balance'> & {
  type: 'BANK' | 'CASH' | 'bank' | 'cash';
  balance?: string;
  current_balance?: string;
};

function toWallet(wallet: ApiWallet): Wallet {
  return {
    ...wallet,
    type: wallet.type === 'BANK' || wallet.type === 'bank' ? 'bank' : 'cash',
    balance: wallet.current_balance ?? wallet.balance ?? wallet.initial_balance ?? '0.00',
    status: wallet.status ?? 'ACTIVE',
    has_transactions: wallet.has_transactions ?? (wallet.transaction_count ?? 0) > 0,
  };
}

function toApiWalletPayload(payload: CreateWalletPayload | UpdateWalletPayload) {
  return {
    ...payload,
    ...(payload.type ? { type: payload.type === 'bank' ? 'BANK' : 'CASH' } : {}),
  };
}

export async function getWallets(signal?: AbortSignal, status?: 'ACTIVE' | 'INACTIVE'): Promise<Wallet[]> {
  const query = status ? `?status=${status}` : '';
  const result = await api<{ data: ApiWallet[] }>(`/wallets${query}`, { signal });
  return result.data.map(toWallet);
}

export async function createWallet(payload: CreateWalletPayload): Promise<CreateWalletResponse> {
  const response = await api<CreateWalletResponse | ApiWallet>('/wallets', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(toApiWalletPayload(payload)),
  });
  if ('wallet' in response) return { ...response, wallet: toWallet(response.wallet as ApiWallet) };
  const wallet = toWallet(response as ApiWallet);
  return { wallet, confirmation_message: `Monedero “${wallet.name}” creado.` };
}

export async function getWallet(id: string, signal?: AbortSignal): Promise<Wallet> {
  return toWallet(await api<ApiWallet>(`/wallets/${encodeURIComponent(id)}`, { signal }));
}

export async function getWalletTransactionCount(id: string, signal?: AbortSignal): Promise<number> {
  const query = new URLSearchParams({ wallet_id: id, date_from: '2000-01-01', date_to: '2999-12-31', page: '1', page_size: '1' });
  const response = await api<{ meta?: { total?: number }; data?: unknown[] }>(`/transactions?${query}`, { signal });
  return response.meta?.total ?? response.data?.length ?? 0;
}

export async function updateWallet(id: string, payload: UpdateWalletPayload): Promise<Wallet> {
  return toWallet(await api<ApiWallet>(`/wallets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(toApiWalletPayload(payload)),
  }));
}

export async function deleteWallet(id: string): Promise<void> {
  await api<void>(`/wallets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function setDefaultWallet(id: string): Promise<Wallet> {
  return toWallet(await api<ApiWallet>(`/wallets/${encodeURIComponent(id)}/default`, { method: 'POST' }));
}

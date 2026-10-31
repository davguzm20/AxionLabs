import type {
  CreateWalletPayload,
  UpdateWalletPayload,
  Wallet,
  WalletListResponse,
} from '../types/wallet.types';

const API_BASE = '/api/v1/wallets';

interface ApiErrorBody {
  error?: { code?: string; message?: string };
  message?: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = 'No se pudo completar la operación. Inténtalo nuevamente.';
    try {
      const body = await response.json() as ApiErrorBody;
      message = body.error?.message ?? body.message ?? message;
    } catch {
      // Mantiene el mensaje genérico si la respuesta no contiene JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function getWallets(signal?: AbortSignal): Promise<Wallet[]> {
  const response = await fetch(API_BASE, { signal });
  const result = await parseResponse<WalletListResponse>(response);
  return result.data;
}

export async function createWallet(payload: CreateWalletPayload): Promise<Wallet> {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<Wallet>(response);
}

export async function updateWallet(id: string, payload: UpdateWalletPayload): Promise<Wallet> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<Wallet>(response);
}

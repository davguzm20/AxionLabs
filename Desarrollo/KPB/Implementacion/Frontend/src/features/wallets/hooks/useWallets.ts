import { useCallback, useEffect, useState } from 'react';
import { createWallet as createWalletRequest, getWallets, updateWallet as updateWalletRequest } from '../services/walletService';
import type { CreateWalletPayload, UpdateWalletPayload, Wallet } from '../types/wallet.types';

export function useWallets() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWallets = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setWallets(await getWallets(signal));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los monederos.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWallets(controller.signal);
    return () => controller.abort();
  }, [loadWallets]);

  const create = async (payload: CreateWalletPayload) => {
    setSaving(true);
    setError(null);
    try {
      const wallet = await createWalletRequest(payload);
      setWallets((current) => [...current, wallet]);
      return wallet;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo crear el monedero.';
      setError(message);
      throw cause;
    } finally {
      setSaving(false);
    }
  };

  const update = async (id: string, payload: UpdateWalletPayload) => {
    setSaving(true);
    setError(null);
    try {
      const wallet = await updateWalletRequest(id, payload);
      setWallets((current) => current.map((item) => item.id === id ? wallet : item));
      return wallet;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo actualizar el monedero.';
      setError(message);
      throw cause;
    } finally {
      setSaving(false);
    }
  };

  return { wallets, loading, saving, error, clearError: () => setError(null), reload: loadWallets, create, update };
}

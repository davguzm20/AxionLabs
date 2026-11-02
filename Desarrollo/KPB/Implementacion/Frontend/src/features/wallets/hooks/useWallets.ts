import { useCallback, useEffect, useState } from 'react';
import {
  createWallet as createWalletRequest,
  deleteWallet as deleteWalletRequest,
  getWallets,
  setDefaultWallet as setDefaultWalletRequest,
  updateWallet as updateWalletRequest,
} from '../services/walletService';
import type { CreateWalletPayload, UpdateWalletPayload, Wallet } from '../types/wallet.types';

export function useWallets() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingWalletId, setSavingWalletId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadWallets = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      setWallets(await getWallets(signal));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setLoadError(cause instanceof Error ? cause.message : 'No se pudieron cargar los monederos.');
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
    setActionError(null);
    try {
      const wallet = await createWalletRequest(payload);
      setWallets((current) => [...current, wallet.wallet]);
      return wallet;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo crear el monedero.';
      setActionError(message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const refreshWallets = async () => setWallets(await getWallets());

  async function runWalletAction(id: string, action: () => Promise<unknown>): Promise<boolean> {
    setSavingWalletId(id);
    setActionError(null);
    try {
      await action();
      await refreshWallets();
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo actualizar el monedero.');
      return false;
    } finally {
      setSavingWalletId(null);
    }
  }

  const update = (id: string, payload: UpdateWalletPayload) => runWalletAction(id, () => updateWalletRequest(id, payload));
  const markDefault = (id: string) => runWalletAction(id, () => setDefaultWalletRequest(id));
  const deactivate = (id: string) => runWalletAction(id, () => deleteWalletRequest(id));
  const reactivate = (id: string) => runWalletAction(id, () => updateWalletRequest(id, { status: 'ACTIVE' }));

  const clearError = () => {
    setLoadError(null);
    setActionError(null);
  };

  return {
    wallets,
    loading,
    saving,
    savingWalletId,
    loadError,
    actionError,
    error: actionError ?? loadError,
    clearError,
    reload: loadWallets,
    create,
    update,
    markDefault,
    deactivate,
    reactivate,
  };
}

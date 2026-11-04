import { useCallback, useEffect, useState } from 'react';
import { getThresholds, putThresholds } from '../services/thresholdService';
import type { AlertThreshold } from '../types/alert.types';

export function useThresholds(categoryId: string) {
  const [config, setConfig] = useState<AlertThreshold | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setConfig(await getThresholds(categoryId, signal));
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración de alertas.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const save = async (values: Pick<AlertThreshold, 'thresholds' | 'channels'>) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await putThresholds(categoryId, values);
      setConfig(saved);
      return saved;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo guardar la configuración de alertas.';
      setError(message);
      throw cause;
    } finally {
      setSaving(false);
    }
  };

  return { config, loading, saving, error, reload, save };
}

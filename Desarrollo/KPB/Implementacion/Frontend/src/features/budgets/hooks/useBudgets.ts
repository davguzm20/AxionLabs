import { useCallback, useEffect, useState } from 'react';
import { getBudgets, getExpenseCategories, saveAlertThreshold, saveBudget } from '../services/budgetService';
import type { Budget, Category } from '../types/budget.types';

export function useBudgets() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [period, setPeriod] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await getBudgets(signal);
      setBudgets(result.data);
      setPeriod(result.period);
      setCategories(await getExpenseCategories(signal));
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los presupuestos.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const save = async (categoryId: string, monthlyLimit: string, threshold: number) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveBudget(categoryId, { monthly_limit: monthlyLimit });
      await saveAlertThreshold(categoryId, threshold);
      setBudgets((current) => current.map((budget) => budget.category_id === categoryId ? { ...updated, alert_threshold: threshold } : budget));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo guardar el presupuesto.';
      setError(message);
      throw cause;
    } finally {
      setSaving(false);
    }
  };

  return { budgets, categories, period, loading, saving, error, reload, save, clearError: () => setError(null) };
}

import { useCallback, useEffect, useState } from 'react';
import {
  classifyTransaction,
  getCategories,
  getFallbackCategory,
} from '../services/classificationService';
import type {
  Category,
  ClassificationResponse,
  Transaction,
} from '../types/classification.types';

const initialTransaction: Transaction = {
  id: 'demo-transaction-1',
  type: 'EXPENSE',
  amount: '12.00',
  currency: 'PEN',
  concept: 'Café con leche',
};

interface ClassificationState {
  categories: Category[];
  transaction: Transaction;
  selectedCategory: Category | null;
  classification: ClassificationResponse | null;
  loading: boolean;
  error: string | null;
  saved: boolean;
}

export function useClassification() {
  const [state, setState] = useState<ClassificationState>({
    categories: [],
    transaction: initialTransaction,
    selectedCategory: null,
    classification: null,
    loading: true,
    error: null,
    saved: false,
  });

  const classify = useCallback(async (signal?: AbortSignal) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const categories = await getCategories(signal);
      let classification: ClassificationResponse;
      try {
        classification = await classifyTransaction({
          concept: initialTransaction.concept,
          amount: initialTransaction.amount,
        }, signal);
      } catch (cause) {
        if (signal?.aborted) return;
        const fallback = getFallbackCategory(categories);
        classification = {
          category: fallback,
          confidence: 0,
          reason: cause instanceof Error ? cause.message : 'No se encontró una coincidencia clara.',
          needs_review: true,
          is_fallback: true,
        };
      }
      const matchingCategory = categories.find(({ id }) => id === classification.category.id);
      const suggestedCategory = matchingCategory ?? getFallbackCategory(categories);
      const validatedClassification = matchingCategory
        ? classification
        : { ...classification, category: suggestedCategory, needs_review: true, is_fallback: true };

      setState((current) => ({
        ...current,
        categories,
        selectedCategory: suggestedCategory,
        classification: validatedClassification,
        loading: false,
        error: null,
      }));
    } catch {
      if (signal?.aborted) return;
      setState((current) => ({ ...current, loading: false, error: 'No pudimos sugerir una categoría. Vuelve a intentarlo.' }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void classify(controller.signal);
    return () => controller.abort();
  }, [classify]);

  const selectCategory = useCallback((category: Category) => {
    setState((current) => ({ ...current, selectedCategory: category, saved: false }));
  }, []);

  const confirmCategory = useCallback(() => {
    setState((current) => ({
      ...current,
      transaction: current.selectedCategory
        ? { ...current.transaction, category: current.selectedCategory }
        : current.transaction,
      saved: current.selectedCategory !== null,
    }));
  }, []);

  return { ...state, selectCategory, confirmCategory, retry: () => void classify() };
}

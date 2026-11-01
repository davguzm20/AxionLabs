import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBudget,
  deactivateBudget,
  getBudget,
  listBudgets,
  listExpenseCategories,
  reactivateBudget,
  replaceBudgetThresholds,
  updateBudget,
} from '../services/budgetService';
import type {
  Budget,
  BudgetCreatePayload,
  BudgetStatus,
  BudgetUpdatePayload,
} from '../types/budget.types';

interface SaveBudgetVariables {
  budgetId?: string;
  createPayload: BudgetCreatePayload;
  updatePayload: BudgetUpdatePayload;
  thresholds: number[];
}

export function useBudgets(status: BudgetStatus = 'ACTIVE') {
  const queryClient = useQueryClient();
  const budgetsQuery = useQuery({
    queryKey: ['budgets', status],
    queryFn: ({ signal }) => listBudgets(status, signal),
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories', 'EXPENSE'],
    queryFn: ({ signal }) => listExpenseCategories(signal),
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation<Budget, Error, SaveBudgetVariables>({
    mutationFn: async ({ budgetId, createPayload, updatePayload, thresholds }) => {
      if (!budgetId) return createBudget(createPayload);

      await updateBudget(budgetId, updatePayload);
      await replaceBudgetThresholds(budgetId, thresholds);
      return getBudget(budgetId);
    },
    onSettled: async (_data, _error, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['budgets'] });
      if (variables.budgetId) {
        await queryClient.invalidateQueries({ queryKey: ['budget', variables.budgetId] });
      }
    },
  });

  const deactivateMutation = useMutation<void, Error, string>({
    mutationFn: deactivateBudget,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['budgets'] }),
  });

  const reactivateMutation = useMutation<Budget, Error, string>({
    mutationFn: reactivateBudget,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['budgets'] }),
  });

  return {
    budgets: budgetsQuery.data?.data ?? [],
    categories: categoriesQuery.data ?? [],
    isLoading: budgetsQuery.isPending,
    isCategoriesLoading: categoriesQuery.isPending,
    error: budgetsQuery.error,
    categoriesError: categoriesQuery.error,
    refetch: budgetsQuery.refetch,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
    deactivate: deactivateMutation.mutateAsync,
    isDeactivating: deactivateMutation.isPending,
    reactivate: reactivateMutation.mutateAsync,
    isReactivating: reactivateMutation.isPending,
  };
}

export function useBudgetDetails(budgetId?: string) {
  return useQuery({
    queryKey: ['budget', budgetId],
    queryFn: ({ signal }) => getBudget(budgetId!, signal),
    enabled: Boolean(budgetId),
  });
}

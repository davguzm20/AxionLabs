import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getWallets } from '../../wallets/services/walletService';
import {
  correctTransaction,
  getTransaction,
  getTransactionSummary,
  listHistoryCategories,
  listTransactions,
} from '../services/historyService';
import type { HistoryFilters, TransactionCorrection } from '../types/history.types';

const historyQueryKey = ['history'] as const;

export function useHistory(filters: HistoryFilters) {
  const queryClient = useQueryClient();
  const filterKey = [filters.date_from, filters.date_to, filters.type ?? 'ALL', filters.category_id ?? '', filters.wallet_id ?? '', filters.q ?? ''];
  const transactionsQuery = useInfiniteQuery({
    queryKey: [...historyQueryKey, 'transactions', ...filterKey],
    queryFn: ({ pageParam, signal }) => listTransactions(filters, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.meta.page < lastPage.meta.pages ? lastPage.meta.page + 1 : undefined,
  });
  const summaryQuery = useQuery({
    queryKey: [...historyQueryKey, 'summary', ...filterKey],
    queryFn: ({ signal }) => getTransactionSummary(filters, signal),
  });
  const categoriesQuery = useQuery({
    queryKey: [...historyQueryKey, 'categories'],
    queryFn: ({ signal }) => listHistoryCategories(signal),
    staleTime: 5 * 60_000,
  });
  const walletsQuery = useQuery({
    queryKey: [...historyQueryKey, 'wallets'],
    queryFn: ({ signal }) => getWallets(signal),
    staleTime: 60_000,
  });
  const transactionMutation = useMutation({
    mutationFn: ({ id, correction }: { id: string; correction: TransactionCorrection }) => correctTransaction(id, correction),
    onSuccess: async (transaction) => {
      queryClient.setQueryData([...historyQueryKey, 'transaction', transaction.id], transaction);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: historyQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['budgets'] }),
      ]);
    },
  });

  return {
    transactions: transactionsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    total: transactionsQuery.data?.pages[0]?.meta.total ?? 0,
    summary: summaryQuery.data?.by_currency ?? [],
    categories: categoriesQuery.data ?? [],
    wallets: walletsQuery.data ?? [],
    isLoading: transactionsQuery.isPending || summaryQuery.isPending || categoriesQuery.isPending || walletsQuery.isPending,
    error: transactionsQuery.error ?? summaryQuery.error ?? categoriesQuery.error ?? walletsQuery.error,
    refetch: () => Promise.all([
      transactionsQuery.refetch(), summaryQuery.refetch(), categoriesQuery.refetch(), walletsQuery.refetch(),
    ]),
    hasNextPage: transactionsQuery.hasNextPage,
    isFetchingNextPage: transactionsQuery.isFetchingNextPage,
    fetchNextPage: transactionsQuery.fetchNextPage,
    getTransaction: (id: string) => queryClient.fetchQuery({
      queryKey: [...historyQueryKey, 'transaction', id],
      queryFn: ({ signal }) => getTransaction(id, signal),
    }),
    correct: transactionMutation.mutateAsync,
    isCorrecting: transactionMutation.isPending,
  };
}

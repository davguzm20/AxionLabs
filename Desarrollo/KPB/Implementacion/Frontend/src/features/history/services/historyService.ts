import { api } from '../../../lib/api';
import type {
  HistoryCategory,
  HistoryFilters,
  HistoryListResponse,
  HistorySummaryResponse,
  HistoryTransaction,
  TransactionCorrection,
} from '../types/history.types';

const PAGE_SIZE = 20;

function buildFiltersQuery(filters: HistoryFilters): URLSearchParams {
  const query = new URLSearchParams({ date_from: filters.date_from, date_to: filters.date_to });
  if (filters.type) query.set('type', filters.type);
  if (filters.category_id) query.set('category_id', filters.category_id);
  if (filters.wallet_id) query.set('wallet_id', filters.wallet_id);
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  return query;
}

export function listTransactions(
  filters: HistoryFilters,
  page: number,
  signal?: AbortSignal,
): Promise<HistoryListResponse> {
  const query = buildFiltersQuery(filters);
  query.set('page', String(page));
  query.set('page_size', String(PAGE_SIZE));
  return api<HistoryListResponse>(`/transactions?${query.toString()}`, { signal });
}

export function getTransactionSummary(
  filters: HistoryFilters,
  signal?: AbortSignal,
): Promise<HistorySummaryResponse> {
  return api<HistorySummaryResponse>(`/transactions/summary?${buildFiltersQuery(filters).toString()}`, { signal });
}

export function getTransaction(id: string, signal?: AbortSignal): Promise<HistoryTransaction> {
  return api<HistoryTransaction>(`/transactions/${encodeURIComponent(id)}`, { signal });
}

export async function listHistoryCategories(signal?: AbortSignal): Promise<HistoryCategory[]> {
  const response = await api<HistoryCategory[] | { data: HistoryCategory[] }>('/categories', { signal });
  const categories = Array.isArray(response) ? response : response.data;
  return categories.filter((category) => category.status !== 'INACTIVE');
}

export function correctTransaction(id: string, correction: TransactionCorrection): Promise<HistoryTransaction> {
  return api<HistoryTransaction>(`/transactions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(correction),
  });
}

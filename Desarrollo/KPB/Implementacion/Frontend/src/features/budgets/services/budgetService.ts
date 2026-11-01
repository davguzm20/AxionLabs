import { api } from '../../../lib/api';
import type {
  Budget,
  BudgetCreatePayload,
  BudgetListResponse,
  BudgetStatus,
  BudgetUpdatePayload,
  Category,
  CategoryListResponse,
} from '../types/budget.types';

export async function listBudgets(
  status: BudgetStatus,
  signal?: AbortSignal,
): Promise<BudgetListResponse> {
  const query = new URLSearchParams({ status });
  return api<BudgetListResponse>(`/budgets?${query.toString()}`, { signal });
}

export async function getBudget(id: string, signal?: AbortSignal): Promise<Budget> {
  return api<Budget>(`/budgets/${encodeURIComponent(id)}`, { signal });
}

export async function listExpenseCategories(signal?: AbortSignal): Promise<Category[]> {
  const query = new URLSearchParams({ type: 'EXPENSE' });
  const response = await api<CategoryListResponse | Category[]>(`/categories?${query.toString()}`, { signal });
  const categories = Array.isArray(response) ? response : response.data;
  return categories.filter((category) => category.type === 'EXPENSE' && category.status !== 'INACTIVE');
}

export async function createBudget(payload: BudgetCreatePayload): Promise<Budget> {
  return api<Budget>('/budgets', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

export async function updateBudget(
  id: string,
  payload: BudgetUpdatePayload,
): Promise<Budget> {
  return api<Budget>(`/budgets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function replaceBudgetThresholds(id: string, thresholds: number[]): Promise<void> {
  await api<unknown>(`/budgets/${encodeURIComponent(id)}/thresholds`, {
    method: 'PUT',
    body: JSON.stringify({ thresholds }),
  });
}

export async function deactivateBudget(id: string): Promise<void> {
  await api<void>(`/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function reactivateBudget(id: string): Promise<Budget> {
  return api<Budget>(`/budgets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACTIVE' satisfies BudgetStatus }),
  });
}

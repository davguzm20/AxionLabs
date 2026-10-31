import type { Budget, BudgetUpsertPayload, BudgetsResponse, Category } from '../types/budget.types';

const API = '/api/v1';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(body?.error?.message ?? body?.message ?? 'No se pudo completar la operación.');
  }
  return response.json() as Promise<T>;
}

export async function getBudgets(signal?: AbortSignal): Promise<BudgetsResponse> {
  return request<BudgetsResponse>(`${API}/budgets`, { signal });
}

export async function getExpenseCategories(signal?: AbortSignal): Promise<Category[]> {
  const result = await request<Category[] | { data: Category[] }>(`${API}/categories`, { signal });
  const categories = Array.isArray(result) ? result : result.data;
  return categories.filter((category) => category.type !== 'INCOME');
}

export async function saveBudget(categoryId: string, payload: BudgetUpsertPayload): Promise<Budget> {
  return request<Budget>(`${API}/budgets/${encodeURIComponent(categoryId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

export async function saveAlertThreshold(categoryId: string, percentage: number): Promise<void> {
  await request<unknown>(`${API}/budgets/${encodeURIComponent(categoryId)}/alert-thresholds`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thresholds: [percentage] }),
  });
}

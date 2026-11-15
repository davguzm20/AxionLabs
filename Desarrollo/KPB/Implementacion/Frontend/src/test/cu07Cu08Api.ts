import type { Budget, BudgetCreatePayload } from '../features/budgets/types/budget.types';
import type { SavedTransactionResponse } from '../features/chat/transactionPreview.types';
import { budgetToday } from '../mocks/budgetPeriods';

export const MOCK_API = 'http://localhost/api/v1';
export const mockHeaders = { Authorization: 'Bearer cu07-cu08-token', 'Content-Type': 'application/json' };

export function mockRequest(path: string, method = 'GET', body?: unknown) {
  return fetch(`${MOCK_API}${path}`, {
    method,
    headers: { ...mockHeaders, 'Idempotency-Key': crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function createTestBudget(overrides: Partial<BudgetCreatePayload> = {}): Promise<Budget> {
  const response = await mockRequest('/budgets', 'POST', {
    category_id: 'category-health', currency: 'PEN', amount: '100.00', period_type: 'MONTHLY',
    thresholds: [80, 100], ...overrides,
  });
  if (response.status !== 201) throw new Error(`No se creó el presupuesto: ${await response.text()}`);
  return response.json() as Promise<Budget>;
}

export async function createTestExpense(amount: string, overrides: Record<string, unknown> = {}): Promise<SavedTransactionResponse> {
  const response = await mockRequest('/transactions', 'POST', {
    type: 'EXPENSE', amount, currency: 'PEN', concept: 'Prueba de presupuesto',
    occurred_at: `${budgetToday()}T12:00:00-05:00`, wallet_id: 'wallet-cash-default',
    category_id: 'category-health', category_source: 'manual', ...overrides,
  });
  if (response.status !== 201) throw new Error(`No se creó el movimiento: ${await response.text()}`);
  return response.json() as Promise<SavedTransactionResponse>;
}

export async function readTestBudget(id: string): Promise<Budget> {
  return (await mockRequest(`/budgets/${id}`)).json() as Promise<Budget>;
}

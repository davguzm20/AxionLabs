import { beforeEach, describe, expect, it } from 'vitest';
import { resetBudgetMocks } from './handlers';

const API = 'http://localhost/api/v1';
const headers = {
  Authorization: 'Bearer test-token',
  'Content-Type': 'application/json',
};

async function postExpense(amount: string) {
  return fetch(`${API}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'EXPENSE',
      amount,
      currency: 'PEN',
      concept: 'Gasto de prueba',
      transaction_date: new Date().toISOString().slice(0, 10),
      wallet_id: 'wallet-cash-default',
      category_id: 'category-health',
    }),
  });
}

describe('MSW budget notifications', () => {
  beforeEach(() => {
    resetBudgetMocks();
    localStorage.setItem('access_token', 'test-token');
  });

  it('emits configured thresholds once and supports read state', async () => {
    const createdBudget = await fetch(`${API}/budgets`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'budget-test-1' },
      body: JSON.stringify({
        category_id: 'category-health',
        currency: 'PEN',
        amount: '100.00',
        period_type: 'MONTHLY',
        thresholds: [80, 100],
      }),
    });
    expect(createdBudget.status).toBe(201);

    const firstExpense = await postExpense('80.00');
    const firstResult = await firstExpense.json();
    expect(firstResult.alerts).toHaveLength(1);
    expect(firstResult.alerts[0].threshold_percentage).toBe(80);

    const secondExpense = await postExpense('20.00');
    const secondResult = await secondExpense.json();
    expect(secondResult.alerts[0].priority).toBe('high');

    const extraExpense = await postExpense('5.00');
    const extraResult = await extraExpense.json();
    expect(extraResult.alerts).toHaveLength(0);

    const list = await fetch(`${API}/notifications?status=UNREAD`, { headers });
    const body = await list.json();
    expect(body.meta.total).toBe(2);
    expect(body.data[0].title).toContain('100%');

    const marked = await fetch(`${API}/notifications/${body.data[0].id}/read`, { method: 'PATCH', headers });
    expect((await marked.json()).status).toBe('READ');

    const remaining = await fetch(`${API}/notifications?status=UNREAD`, { headers });
    expect((await remaining.json()).meta.total).toBe(1);
  });

  it('stores the email preference independently from in-app notifications', async () => {
    const update = await fetch(`${API}/users/me/preferences`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ email_notifications: false }),
    });

    expect((await update.json()).email_notifications).toBe(false);
    const readBack = await fetch(`${API}/users/me/preferences`, { headers });
    expect((await readBack.json()).email_notifications).toBe(false);
  });

});

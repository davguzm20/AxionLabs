import { beforeEach, describe, expect, it } from 'vitest';
import { resetBudgetMocks } from './handlers';

const API = 'http://localhost/api/v1';
const headers = { Authorization: 'Bearer wallet-balance-test-token', 'Content-Type': 'application/json' };
const bcpWalletId = '4d6b3036-4290-4bde-aea4-375c779ef48b';
const foodCategoryId = 'f61d5fcc-730a-48d9-81dc-1db75ce4af16';

async function getBcpBalance() {
  const response = await fetch(`${API}/wallets`, { headers });
  const { data } = await response.json();
  return data.find((wallet: { id: string }) => wallet.id === bcpWalletId).balance as string;
}

async function saveTransaction(input: { type: 'INCOME' | 'EXPENSE'; amount: string; concept: string; categoryId: string }) {
  return fetch(`${API}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: input.type,
      amount: input.amount,
      currency: 'PEN',
      concept: input.concept,
      transaction_date: new Date().toISOString().slice(0, 10),
      wallet_id: bcpWalletId,
      category_id: input.categoryId,
    }),
  });
}

describe('saldo de monedero al guardar movimientos', () => {
  beforeEach(() => {
    resetBudgetMocks();
    localStorage.setItem('access_token', 'wallet-balance-test-token');
  });

  it('suma los ingresos y resta los gastos del monedero elegido', async () => {
    expect(await getBcpBalance()).toBe('185.00');

    const income = await saveTransaction({ type: 'INCOME', amount: '500.00', concept: 'Pago freelance', categoryId: 'category-freelance' });
    expect(income.status).toBe(201);
    expect(await getBcpBalance()).toBe('685.00');

    const expense = await saveTransaction({ type: 'EXPENSE', amount: '35.50', concept: 'Almuerzo', categoryId: foodCategoryId });
    expect(expense.status).toBe(201);
    expect(await getBcpBalance()).toBe('649.50');
  });

  it('rechaza un movimiento con moneda distinta a la del monedero', async () => {
    const response = await fetch(`${API}/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'INCOME',
        amount: '500.00',
        currency: 'USD',
        concept: 'Pago freelance',
        transaction_date: new Date().toISOString().slice(0, 10),
        wallet_id: bcpWalletId,
        category_id: 'category-freelance',
      }),
    });

    expect(response.status).toBe(422);
    expect(await getBcpBalance()).toBe('185.00');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { resetBudgetMocks } from './handlers';

const API = 'http://localhost/api/v1';
const headers = { Authorization: 'Bearer history-test-token', 'Content-Type': 'application/json' };

function currentMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
  const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { date_from: formatDate(first), date_to: formatDate(last) };
}

describe('MSW del historial', () => {
  beforeEach(() => {
    resetBudgetMocks();
    localStorage.setItem('access_token', 'history-test-token');
  });

  it('devuelve movimientos paginados y totales agrupados por moneda', async () => {
    const range = new URLSearchParams({ ...currentMonthRange(), page: '1', page_size: '20' });
    const listResponse = await fetch(`${API}/transactions?${range}`, { headers });
    const list = await listResponse.json();

    expect(list.meta).toMatchObject({ page: 1, page_size: 20, total: 5, pages: 1 });
    expect(list.data.map((transaction: { concept: string }) => transaction.concept)).toContain('Cena');

    const summaryResponse = await fetch(`${API}/transactions/summary?${new URLSearchParams(currentMonthRange())}`, { headers });
    const summary = await summaryResponse.json();
    expect(summary.by_currency).toEqual([{ currency: 'PEN', income: '2500.00', expense: '259.70', net: '2240.30' }]);
  });

  it('combina filtros y corrige concepto/categoría sin modificar los totales', async () => {
    const range = new URLSearchParams({ ...currentMonthRange(), type: 'EXPENSE', category_id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16' });
    const listResponse = await fetch(`${API}/transactions?${range}`, { headers });
    const list = await listResponse.json();
    expect(list.meta.total).toBe(2);
    expect(list.data.every((transaction: { type: string }) => transaction.type === 'EXPENSE')).toBe(true);

    const beforeResponse = await fetch(`${API}/transactions/summary?${new URLSearchParams(currentMonthRange())}`, { headers });
    const before = await beforeResponse.json();
    const updateResponse = await fetch(`${API}/transactions/history-dinner`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ concept: 'Cena con amigos', category_id: 'category-friends' }),
    });
    const updated = await updateResponse.json();
    expect(updated.concept).toBe('Cena con amigos');
    expect(updated.category.id).toBe('category-friends');

    const afterResponse = await fetch(`${API}/transactions/summary?${new URLSearchParams(currentMonthRange())}`, { headers });
    const after = await afterResponse.json();
    expect(after.by_currency).toEqual(before.by_currency);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationListResponse } from '../features/notifications/types/notification.types';
import { createTestBudget, createTestExpense, mockRequest, readTestBudget } from '../test/cu07Cu08Api';
import { resetFrontendState } from '../test/resetFrontendState';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T17:00:00Z'));
  resetFrontendState();
  localStorage.setItem('access_token', 'cu07-cu08-token');
});

afterEach(() => vi.useRealTimers());

async function notifications() {
  const response = await mockRequest('/notifications');
  expect(response.status).toBe(200);
  return response.json() as Promise<NotificationListResponse>;
}

describe('CU08 — casos límite del motor de alertas simulado con MSW', () => {
  it('consolida un cruce simultáneo en el aviso de mayor umbral y marca todos los alcanzados', async () => {
    const budget = await createTestBudget({ thresholds: [90, 75, 100, 80] });
    const result = await createTestExpense('95.00');

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({ threshold_percentage: 90, usage_percentage: 95, remaining: '5.00', priority: 'normal' });
    const saved = await readTestBudget(budget.id);
    expect(saved.thresholds.filter((threshold) => threshold.triggered).map((threshold) => threshold.percentage).sort()).toEqual([75, 80, 90]);
    expect(saved.thresholds.find((threshold) => threshold.percentage === 100)?.triggered).toBe(false);
    expect((await notifications()).meta.total).toBe(1);
    expect((await createTestExpense('1.00')).alerts).toHaveLength(0);
  });

  it.each([
    { amount: '79.99', total: 0 },
    { amount: '80.00', total: 1 },
    { amount: '80.01', total: 1 },
  ])('compara exactamente los céntimos del límite: gasto $amount, avisos $total', async ({ amount, total }) => {
    const budget = await createTestBudget({ thresholds: [80] });
    expect((await createTestExpense(amount)).alerts).toHaveLength(total);
    expect((await notifications()).meta.total).toBe(total);
    expect((await readTestBudget(budget.id)).thresholds[0]?.triggered).toBe(total === 1);
  });

  it('mantiene independientes el consumo y los avisos de dos categorías con topes distintos', async () => {
    const health = await createTestBudget({ thresholds: [90] });
    const other = await createTestBudget({ category_id: 'category-other', amount: '200.00', thresholds: [75] });
    await createTestExpense('95.00');
    expect(await readTestBudget(other.id)).toMatchObject({ consumed: '0.00', percentage: 0 });
    await createTestExpense('150.00', { category_id: 'category-other' });

    expect(await readTestBudget(health.id)).toMatchObject({ consumed: '95.00', remaining: '5.00' });
    expect(await readTestBudget(other.id)).toMatchObject({ consumed: '150.00', remaining: '50.00' });
    const list = await notifications();
    expect(list.meta.total).toBe(2);
    expect(list.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ budget_id: health.id, threshold_percentage: 90, usage_percentage: 95 }),
      expect.objectContaining({ budget_id: other.id, threshold_percentage: 75, usage_percentage: 75 }),
    ]));
    expect(new Set(list.data.map((item) => item.id)).size).toBe(2);
  });

  it('no avisa estando inactivo y evalúa el gasto acumulado una sola vez al reactivarse', async () => {
    const budget = await createTestBudget({ thresholds: [80] });
    expect((await mockRequest(`/budgets/${budget.id}`, 'DELETE')).status).toBe(204);
    expect((await createTestExpense('90.00')).alerts).toHaveLength(0);
    expect((await notifications()).meta.total).toBe(0);
    expect((await readTestBudget(budget.id)).thresholds[0]?.triggered).toBe(false);

    expect((await mockRequest(`/budgets/${budget.id}`, 'PATCH', { status: 'ACTIVE' })).status).toBe(200);
    const list = await notifications();
    expect(list.meta.total).toBe(1);
    expect(list.data[0]).toMatchObject({ budget_id: budget.id, usage_percentage: 90, remaining: '10.00' });
    expect((await createTestExpense('1.00')).alerts).toHaveLength(0);
  });

  it('no asigna al presupuesto inactivo anterior las alertas de su reemplazo activo', async () => {
    const old = await createTestBudget({ thresholds: [75] });
    await mockRequest(`/budgets/${old.id}`, 'DELETE');
    const current = await createTestBudget({ thresholds: [90] });
    await createTestExpense('95.00');

    const list = await notifications();
    expect(list.meta.total).toBe(1);
    expect(list.data[0]).toMatchObject({ budget_id: current.id, threshold_percentage: 90 });
    expect((await readTestBudget(old.id)).thresholds[0]?.triggered).toBe(false);
  });

  it('no evalúa movimientos fuera del periodo mensual vigente', async () => {
    const budget = await createTestBudget();
    for (const date of ['2026-10-31', '2026-12-01']) {
      expect((await createTestExpense('90.00', { occurred_at: `${date}T12:00:00-05:00` })).alerts).toHaveLength(0);
    }

    expect(await readTestBudget(budget.id)).toMatchObject({ consumed: '0.00', remaining: '100.00' });
    expect((await notifications()).meta.total).toBe(0);
  });

  it('evalúa inmediatamente el impacto de bajar el tope y no repite el aviso al aumentarlo', async () => {
    const budget = await createTestBudget({ amount: '200.00', thresholds: [80] });
    expect((await createTestExpense('90.00')).alerts).toHaveLength(0);
    expect((await mockRequest(`/budgets/${budget.id}`, 'PATCH', { amount: '100.00' })).status).toBe(200);
    expect((await notifications()).data[0]).toMatchObject({ budget_id: budget.id, usage_percentage: 90, remaining: '10.00' });

    expect((await mockRequest(`/budgets/${budget.id}`, 'PATCH', { amount: '200.00' })).status).toBe(200);
    expect((await createTestExpense('70.00')).alerts).toHaveLength(0);
    expect((await notifications()).meta.total).toBe(1);
  });

  it('evalúa un umbral recién agregado sobre los gastos previos sin reenviar el umbral ya notificado', async () => {
    const budget = await createTestBudget({ thresholds: [100] });
    await createTestExpense('85.00');
    expect((await notifications()).meta.total).toBe(0);
    expect((await mockRequest(`/budgets/${budget.id}/thresholds`, 'PUT', { thresholds: [80, 100] })).status).toBe(200);
    expect((await notifications()).data[0]).toMatchObject({ threshold_percentage: 80, usage_percentage: 85 });

    await mockRequest(`/budgets/${budget.id}/thresholds`, 'PUT', { thresholds: [100] });
    await mockRequest(`/budgets/${budget.id}/thresholds`, 'PUT', { thresholds: [80, 100] });
    expect((await notifications()).meta.total).toBe(1);
    expect((await readTestBudget(budget.id)).thresholds.find((threshold) => threshold.percentage === 80)?.triggered).toBe(true);
  });

  it.each([
    { label: 'no numérico', thresholds: ['texto'] },
    { label: 'numérico como texto', thresholds: ['80'] },
    { label: 'fraccionario', thresholds: [80.5] },
    { label: 'nulo', thresholds: null },
    { label: 'vacío', thresholds: [] },
    { label: 'duplicado', thresholds: [80, 80] },
  ])('rechaza un conjunto de umbrales $label sin modificar la configuración ni generar eventos', async ({ thresholds }) => {
    const budget = await createTestBudget();
    const response = await mockRequest(`/budgets/${budget.id}/thresholds`, 'PUT', { thresholds });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_THRESHOLD' } });
    expect((await readTestBudget(budget.id)).thresholds).toEqual(budget.thresholds);
    expect((await notifications()).meta.total).toBe(0);
  });

  it('no permite eliminar el último umbral y conserva el restante tras eliminar otro', async () => {
    const budget = await createTestBudget();
    const [first, last] = budget.thresholds;
    if (!first || !last) throw new Error('El presupuesto de prueba debe tener dos umbrales.');
    expect((await mockRequest(`/budgets/${budget.id}/thresholds/${first.id}`, 'DELETE')).status).toBe(204);
    expect((await mockRequest(`/budgets/${budget.id}/thresholds/${last.id}`, 'DELETE')).status).toBe(422);

    expect((await readTestBudget(budget.id)).thresholds).toEqual([last]);
    expect((await createTestExpense('80.00')).alerts).toHaveLength(0);
    expect((await createTestExpense('20.00')).alerts[0]).toMatchObject({ threshold_percentage: 100, remaining: '0.00', priority: 'high' });
    expect((await notifications()).meta.total).toBe(1);
  });
});

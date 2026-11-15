import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from './server';
import { resetFrontendState } from '../test/resetFrontendState';
import { createTestBudget, createTestExpense, mockRequest, readTestBudget } from '../test/cu07Cu08Api';
import type { NotificationListResponse } from '../features/notifications/types/notification.types';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-15T17:00:00Z'));
  resetFrontendState(); localStorage.setItem('access_token', 'cu07-cu08-token');
});
afterEach(() => vi.useRealTimers());

describe('CU07/CU08 — mocks de presupuestos, consumo y alertas', () => {
  it('incluye categorías sin tope y solo categorías de gasto en el listado', async () => {
    const { data } = await (await mockRequest('/budgets')).json();
    expect(data).toContainEqual(expect.objectContaining({ id: null, category: expect.objectContaining({ id: 'category-health' }), status: 'NONE' }));
    expect(data.every((item: { category: { type: string } }) => item.category.type === 'EXPENSE')).toBe(true);
    expect(await readTestBudget('budget-food')).toMatchObject({ consumed: '206.30', remaining: '43.70' });
  });

  it.each(['0.00', '-1.00', 'texto', '0.001', '100000000.00'])('rechaza el tope inválido %s', async (amount) => {
    const response = await mockRequest('/budgets', 'POST', { category_id: 'category-health', currency: 'PEN', amount, period_type: 'MONTHLY' });
    expect(response.status).toBe(422);
  });

  it('rechaza categorías inexistentes y de ingreso', async () => {
    for (const category_id of ['inexistente', 'category-salary']) {
      expect((await mockRequest('/budgets', 'POST', { category_id, currency: 'PEN', amount: '100.00', period_type: 'MONTHLY' })).status).toBe(422);
    }
  });

  it('calcula gastos previos al crear el tope y evalúa el impacto', async () => {
    await createTestExpense('80.00');
    const budget = await createTestBudget();
    expect(budget).toMatchObject({ consumed: '80.00', remaining: '20.00', percentage: 80 });
    expect(budget.thresholds[0]?.triggered).toBe(true);
  });

  it('guarda monto y umbrales de forma conjunta sin cambios parciales ante un error', async () => {
    const budget = await createTestBudget();
    expect((await mockRequest(`/budgets/${budget.id}`, 'PATCH', { amount: '200.00', thresholds: [101] })).status).toBe(422);
    expect(await readTestBudget(budget.id)).toMatchObject({ amount: '100.00', thresholds: budget.thresholds });
    expect((await mockRequest(`/budgets/${budget.id}`, 'PATCH', { amount: '200.00', thresholds: [20, 30, 75, 80, 90, 100] })).status).toBe(200);
    expect((await readTestBudget(budget.id)).thresholds).toHaveLength(6);
  });

  it('edita los umbrales del presupuesto activo sin alterar su antecesor inactivo', async () => {
    const old = await createTestBudget(); await mockRequest(`/budgets/${old.id}`, 'DELETE');
    const current = await createTestBudget({ thresholds: [75] });
    await mockRequest(`/budgets/${current.id}/thresholds`, 'PUT', { thresholds: [90] });
    expect((await readTestBudget(current.id)).thresholds.map((item) => item.percentage)).toEqual([90]);
    expect((await readTestBudget(old.id)).thresholds.map((item) => item.percentage)).toEqual([80, 100]);
  });

  it.each([
    { period_type: 'MONTHLY' as const, next: '2026-12-01T05:00:00Z', end: '2026-12-31', start_date: null, period_days: null },
    { period_type: 'WEEKLY' as const, next: '2026-11-16T05:00:00Z', end: '2026-11-22', start_date: null, period_days: null },
    { period_type: 'CUSTOM' as const, next: '2026-11-16T05:00:00Z', end: '2026-11-17', start_date: '2026-11-14', period_days: 2 },
  ])('renueva consumo y avisos del periodo $period_type', async ({ next, end, ...period }) => {
    const budget = await createTestBudget(period);
    expect((await createTestExpense('80.00')).alerts).toHaveLength(1);
    vi.setSystemTime(new Date(next));
    const renewed = await readTestBudget(budget.id);
    expect(renewed).toMatchObject({ consumed: '0.00', remaining: '100.00', percentage: 0, period_end: end });
    expect(renewed.thresholds.every((item) => !item.triggered)).toBe(true);
    expect((await createTestExpense('80.00')).alerts).toHaveLength(1);
  });

  it('recalcula el consumo al cambiar de mensual a semanal', async () => {
    await createTestExpense('50.00', { occurred_at: '2026-11-01T12:00:00-05:00' });
    const budget = await createTestBudget(); expect(budget.consumed).toBe('50.00');
    await mockRequest(`/budgets/${budget.id}`, 'PATCH', { period_type: 'WEEKLY' });
    expect(await readTestBudget(budget.id)).toMatchObject({ consumed: '0.00', period_start: '2026-11-09' });
  });

  it('no suma ingresos, otras categorías ni otra moneda al consumo', async () => {
    const budget = await createTestBudget();
    await createTestExpense('80.00', { type: 'INCOME', category_id: 'category-salary' });
    await createTestExpense('80.00', { category_id: 'category-other' });
    const wallet = (await (await mockRequest('/wallets', 'POST', { name: 'Dólares', type: 'CASH', currency: 'USD', initial_balance: '200.00' })).json()).wallet;
    await createTestExpense('80.00', { currency: 'USD', wallet_id: wallet.id });
    expect(await readTestBudget(budget.id)).toMatchObject({ consumed: '0.00', remaining: '100.00' });
  });

  it('recalcula ambas categorías tras reclasificar un gasto', async () => {
    const budget = await createTestBudget(); const expense = await createTestExpense('10.00');
    await mockRequest(`/transactions/${expense.transaction.id}`, 'PATCH', { category_id: 'category-other' });
    expect(await readTestBudget(budget.id)).toMatchObject({ consumed: '0.00' });
  });

  it.each([
    { start_date: '2026-02-30', period_days: 30 },
    { start_date: '2026-11-15', period_days: 0 },
    { start_date: '2026-11-15', period_days: 367 },
    { start_date: '2026-11-15', period_days: 1.5 },
  ])('rechaza un periodo personalizado inválido: %j', async (period) => {
    expect((await mockRequest('/budgets', 'POST', { category_id: 'category-health', currency: 'PEN', amount: '100.00', period_type: 'CUSTOM', ...period })).status).toBe(422);
  });

  it('mantiene exactitud en céntimos y no duplica alertas ya emitidas', async () => {
    const budget = await createTestBudget({ amount: '0.30', thresholds: [100] });
    expect((await createTestExpense('0.10')).alerts).toHaveLength(0);
    expect((await createTestExpense('0.20')).alerts[0]).toMatchObject({ usage_percentage: 100, remaining: '0.00', priority: 'high' });
    expect(await readTestBudget(budget.id)).toMatchObject({ consumed: '0.30', remaining: '0.00' });
    expect((await createTestExpense('0.01')).alerts).toHaveLength(0);
  });

  it('EX2: emite prioridad alta al superar 100% aunque solo exista un umbral de 80%', async () => {
    await createTestBudget({ thresholds: [80] });
    expect((await createTestExpense('110.00')).alerts[0]).toMatchObject({ priority: 'high', usage_percentage: 110, remaining: '-10.00' });
  });

  it('EX2: avisa del sobregiro posterior al aviso previo y no repite ese sobregiro', async () => {
    await createTestBudget({ thresholds: [80] });
    expect((await createTestExpense('80.00')).alerts[0]?.priority).toBe('normal');
    expect((await createTestExpense('30.00')).alerts[0]?.priority).toBe('high');
    expect((await createTestExpense('1.00')).alerts).toHaveLength(0);
  });

  it('conserva fecha, hora, porcentaje, saldo y lectura en una única bandeja', async () => {
    const budget = await createTestBudget(); const transaction = await createTestExpense('80.00');
    const list = await (await mockRequest('/notifications')).json() as NotificationListResponse;
    expect(list.data[0]).toMatchObject({ budget_id: budget.id, usage_percentage: 80, threshold_percentage: 80, remaining: '20.00', currency: 'PEN', created_at: new Date().toISOString() });
    const legacy = await (await mockRequest('/notifications?type=budget_alert')).json();
    expect(legacy.data[0].id).toBe(transaction.alerts[0]?.notification_id);
    await mockRequest('/notifications/read-all', 'PATCH');
    expect((await (await mockRequest('/notifications?status=UNREAD')).json()).meta.total).toBe(0);
    expect((await (await mockRequest('/notifications?type=budget_alert&unread=true')).json()).data).toHaveLength(0);
  });

  it('restaura movimientos, periodos y eventos al recargar los mocks sin duplicarlos', async () => {
    const budget = await createTestBudget(); await createTestExpense('80.00');
    await mockRequest('/notifications/read-all', 'PATCH');
    vi.resetModules(); const fresh = await import('./handlers'); server.resetHandlers(...fresh.handlers);
    expect(await readTestBudget(budget.id)).toMatchObject({ consumed: '80.00' });
    expect((await createTestExpense('1.00')).alerts).toHaveLength(0);
    expect((await (await mockRequest('/notifications')).json()).data[0].status).toBe('READ');
    vi.setSystemTime(new Date('2026-12-01T05:00:00Z'));
    expect(await readTestBudget(budget.id)).toMatchObject({ consumed: '0.00', period_start: '2026-12-01' });
  });
});

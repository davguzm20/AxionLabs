import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { App } from '../App';
import { queryClient } from '../lib/queryClient';
import { server } from '../mocks/server';
import { resetFrontendState } from './resetFrontendState';
import { createTestBudget, createTestExpense, mockRequest, readTestBudget } from './cu07Cu08Api';

beforeEach(() => {
  resetFrontendState(); queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  localStorage.setItem('access_token', 'cu07-cu08-token');
});
afterEach(() => { cleanup(); queryClient.clear(); });

function renderApp(path: string) {
  window.history.replaceState({}, '', path);
  return render(<App />);
}

async function fillBudget(categoryId = 'category-health', amount = '100') {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('Categoría'), categoryId);
  await user.clear(screen.getByLabelText('Tope del periodo'));
  await user.type(screen.getByLabelText('Tope del periodo'), amount);
  return user;
}

describe('CU07 — aplicación real con los mocks generales', () => {
  it('muestra todas las categorías de gasto y crea Servicios sin manejadores añadidos por la prueba', async () => {
    renderApp('/presupuestos/nuevo');
    const select = await screen.findByLabelText('Categoría');
    expect(within(select).queryByRole('option', { name: 'Sueldo' })).not.toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Inversiones' })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Salidas con amigos' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Suscripciones' })).toBeInTheDocument();
    const user = await fillBudget('catalog:Servicios');
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Tope de gasto establecido correctamente.');
    expect(window.location.pathname).toBe('/presupuestos');
    const { data } = await (await mockRequest('/budgets')).json();
    expect(data).toContainEqual(expect.objectContaining({ amount: '100.00', category: expect.objectContaining({ name: 'Servicios', type: 'EXPENSE' }) }));
  });

  it('permite establecer un tope desde una categoría sin presupuesto', async () => {
    renderApp('/presupuestos');
    const health = await screen.findByRole('heading', { name: 'Salud' });
    const user = userEvent.setup();
    await user.click(within(health.closest('article')!).getByRole('button', { name: 'Establecer tope' }));
    expect(await screen.findByLabelText('Categoría')).toHaveValue('category-health');
  });

  it.each(['0', '-1', 'abc', '1.001', '100000000'])('EX2: no guarda el monto inválido %s', async (amount) => {
    const post = vi.fn(() => HttpResponse.json({}, { status: 201 }));
    server.use(http.post('*/api/v1/budgets', post));
    renderApp('/presupuestos/nuevo'); const user = await fillBudget('category-health', amount);
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement(); expect(post).not.toHaveBeenCalled();
  });

  it('edita el monto y seis umbrales en una operación y confirma el resultado', async () => {
    const budget = await createTestBudget(); renderApp(`/presupuestos/${budget.id}/editar`);
    const amount = await screen.findByLabelText('Tope del periodo'); const user = userEvent.setup();
    await user.clear(amount); await user.type(amount, '200');
    await user.click(screen.getByRole('button', { name: '75%' })); await user.click(screen.getByRole('button', { name: '90%' }));
    for (const percentage of ['20', '30']) {
      await user.type(screen.getByLabelText('Otro porcentaje'), percentage);
      await user.click(screen.getByRole('button', { name: 'Agregar porcentaje' }));
    }
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Tope de gasto actualizado correctamente.');
    const saved = await readTestBudget(budget.id);
    expect(saved.amount).toBe('200.00'); expect(saved.thresholds.map((item) => item.percentage)).toEqual([20, 30, 75, 80, 90, 100]);
  });

  it('valida porcentajes fuera de rango, duplicados y ausencia de umbrales', async () => {
    renderApp('/presupuestos/nuevo'); const user = await fillBudget();
    for (const percentage of ['0', '101', '80']) {
      await user.clear(screen.getByLabelText('Otro porcentaje')); await user.type(screen.getByLabelText('Otro porcentaje'), percentage);
      await user.click(screen.getByRole('button', { name: 'Agregar porcentaje' })); expect(screen.getByRole('alert')).not.toBeEmptyDOMElement();
    }
    await user.click(screen.getByRole('button', { name: '80%' }));
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Agrega al menos un porcentaje');
  });

  it('mantiene el formulario y permite reintentar tras un fallo de guardado', async () => {
    const budget = await createTestBudget();
    server.use(http.patch('*/api/v1/budgets/:id', () => HttpResponse.json({ error: { code: 'TEMPORARY_ERROR', message: 'Intenta nuevamente.' } }, { status: 503 })));
    renderApp(`/presupuestos/${budget.id}/editar`); const amount = await screen.findByLabelText('Tope del periodo'); const user = userEvent.setup();
    await user.clear(amount); await user.type(amount, '200'); await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Intenta nuevamente.');
    expect(amount).toHaveValue('200'); expect((await readTestBudget(budget.id)).amount).toBe('100.00');
    server.resetHandlers(); await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Tope de gasto actualizado correctamente.');
  });

  it('EX1: protege presupuestos cuando falta la sesión', async () => {
    localStorage.removeItem('access_token'); renderApp('/presupuestos');
    expect(await screen.findByRole('heading', { name: /Inicia sesi/ })).toBeInTheDocument(); expect(window.location.pathname).toBe('/login');
  });

  it('EX3: comunica una categoría rechazada y permite volver a seleccionarla', async () => {
    server.use(http.post('*/api/v1/budgets', () => HttpResponse.json({ error: { code: 'INVALID_CATEGORY', message: 'Selecciona una categoría válida.' } }, { status: 422 })));
    renderApp('/presupuestos/nuevo'); const user = await fillBudget();
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona una categoría válida.');
    expect(screen.getByLabelText('Categoría')).toBeEnabled();
    server.resetHandlers(); await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Tope de gasto establecido correctamente.');
  });

  it('EX1: monta el manejador real de expiración y limpia el token ante un 401', async () => {
    server.use(http.get('*/api/v1/budgets', () => HttpResponse.json({ error: { code: 'SESSION_EXPIRED', message: 'Sesión vencida.' } }, { status: 401 })));
    renderApp('/presupuestos');
    expect(await screen.findByRole('heading', { name: /Inicia sesi/ })).toBeInTheDocument();
    expect(localStorage.getItem('access_token')).toBeNull(); expect(window.location.pathname).toBe('/login');
  });
});

describe('CU08 — entrega, presentación y lectura con el SSE real del mock', () => {
  it('presenta una alerta enviada por el mock, sin refrescar ni invalidar manualmente las consultas', async () => {
    await createTestBudget(); renderApp('/notificaciones'); await screen.findByText('No tienes notificaciones.');
    const start = performance.now();
    await act(async () => { await createTestExpense('80.00'); });
    expect(await screen.findByText('Cruzaste el 80% de tu presupuesto de Salud.', {}, { timeout: 1_500 })).toBeInTheDocument();
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(screen.getByText('Consumo: 80% del tope.')).toBeInTheDocument();
    expect(screen.getByText('Saldo disponible: S/ 20.00')).toBeInTheDocument();
    const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: /Marcar como leída:/ }));
    expect(await screen.findByText('Leída')).toBeInTheDocument();
    expect((await (await mockRequest('/notifications?status=UNREAD')).json()).meta.total).toBe(0);
  });

  it('EX2: presenta prioridad alta, saldo negativo y acciones para revisar el sobregiro', async () => {
    await createTestBudget({ thresholds: [80] }); renderApp('/notificaciones'); await screen.findByText('No tienes notificaciones.');
    await act(async () => { await createTestExpense('110.00'); });
    expect(await screen.findByText('Consumo: 110% del tope.')).toBeInTheDocument();
    expect(screen.getByText('Saldo disponible: -S/ 10.00')).toBeInTheDocument();
    expect(screen.getByText(/Prioridad alta/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver movimientos' })).toHaveAttribute('href', '/historial');
    expect(screen.getByRole('link', { name: 'Ver presupuesto' })).toHaveAttribute('href', '/presupuestos');
  });

  it('actualiza el contador de la campana y marca todas las alertas como leídas', async () => {
    await createTestBudget(); await createTestExpense('80.00'); renderApp('/inicio');
    const bell = await screen.findByRole('link', { name: 'Notificaciones, 1 sin leer' }); const user = userEvent.setup(); await user.click(bell);
    await screen.findByText('No leída'); await user.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(await screen.findByText('Leída')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Volver al inicio' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Notificaciones' })).toBeInTheDocument());
  });

  it('recupera la bandeja por consultas periódicas si SSE no está disponible', async () => {
    server.use(http.get('*/api/v1/notifications/stream', () => new HttpResponse(null, { status: 503 })));
    await createTestBudget(); renderApp('/notificaciones'); await screen.findByText('No tienes notificaciones.');
    await act(async () => { await createTestExpense('80.00'); });
    expect(await screen.findByText('Cruzaste el 80% de tu presupuesto de Salud.', {}, { timeout: 6_000 })).toBeInTheDocument();
  }, 10_000);
});

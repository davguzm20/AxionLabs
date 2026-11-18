import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { createTestBudget, mockRequest, readTestBudget } from '../../../test/cu07Cu08Api';
import { deferred, renderWithTestRouter } from '../../../test/cu01Cu02TestUtils';
import { resetFrontendState } from '../../../test/resetFrontendState';
import type { BudgetListResponse } from '../types/budget.types';
import { BudgetFormPage } from './BudgetFormPage';

beforeEach(() => {
  resetFrontendState();
  localStorage.setItem('access_token', 'cu07-cu08-token');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(path = '/presupuestos/nuevo') {
  return renderWithTestRouter(
    <Routes>
      <Route path="/presupuestos/nuevo" element={<BudgetFormPage />} />
      <Route path="/presupuestos/:budgetId/editar" element={<BudgetFormPage />} />
      <Route path="/presupuestos" element={<h1>Presupuestos</h1>} />
    </Routes>,
    { path },
  );
}

async function fillForm() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('Categoría'), 'category-health');
  await user.type(screen.getByLabelText('Tope del periodo'), '100');
  return user;
}

function observeCreation() {
  const create = vi.fn(() => HttpResponse.json({}, { status: 201 }));
  server.use(http.post('*/api/v1/budgets', create));
  return create;
}

describe('CU07 — validación y acciones del formulario con MSW', () => {
  it('no envía el presupuesto si no se seleccionó una categoría', async () => {
    const create = observeCreation();
    renderForm();
    await screen.findByLabelText('Categoría');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Tope del periodo'), '100');
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona una categoría de gasto.');
    expect(create).not.toHaveBeenCalled();
  });

  it('no envía un monto vacío y permite corregirlo sin perder la categoría', async () => {
    const create = observeCreation();
    renderForm();
    const user = await fillForm();
    await user.clear(screen.getByLabelText('Tope del periodo'));
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa un monto válido');
    expect(screen.getByLabelText('Categoría')).toHaveValue('category-health');
    expect(create).not.toHaveBeenCalled();

    server.resetHandlers();
    await user.type(screen.getByLabelText('Tope del periodo'), '0.01');
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));
    await waitFor(() => expect(screen.getByLabelText('ruta actual').textContent).toBe('/presupuestos'));
    const result = await (await mockRequest('/budgets')).json() as BudgetListResponse;
    expect(result.data).toContainEqual(expect.objectContaining({ category: expect.objectContaining({ id: 'category-health' }), amount: '0.01' }));
  });

  it.each(['', '2026-02-30'])('rechaza la fecha personalizada vacía o inexistente %j', async (date) => {
    const create = observeCreation();
    renderForm();
    const user = await fillForm();
    await user.selectOptions(screen.getByLabelText('Periodo'), 'CUSTOM');
    // Los controles de fecha del navegador también descartan fechas inexistentes.
    fireEvent.change(screen.getByLabelText('Fecha de inicio'), { target: { value: date } });
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Indica la fecha de inicio.');
    expect(screen.getByLabelText('Fecha de inicio')).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['', '0', '367', '1.5'])('rechaza los días personalizados inválidos %j desde la pantalla', async (days) => {
    const create = observeCreation();
    renderForm();
    const user = await fillForm();
    await user.selectOptions(screen.getByLabelText('Periodo'), 'CUSTOM');
    fireEvent.change(screen.getByLabelText('Fecha de inicio'), { target: { value: '2026-11-15' } });
    const input = screen.getByLabelText('Días del periodo');
    await user.clear(input);
    if (days) await user.type(input, days);
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Los días deben estar entre 1 y 366.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([1, 366])('guarda un periodo personalizado en el límite válido de %i días', async (days) => {
    renderForm();
    const user = await fillForm();
    await user.selectOptions(screen.getByLabelText('Periodo'), 'CUSTOM');
    fireEvent.change(screen.getByLabelText('Fecha de inicio'), { target: { value: '2026-11-15' } });
    await user.clear(screen.getByLabelText('Días del periodo'));
    await user.type(screen.getByLabelText('Días del periodo'), String(days));
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));

    await waitFor(() => expect(screen.getByLabelText('ruta actual').textContent).toBe('/presupuestos'));
    const result = await (await mockRequest('/budgets')).json() as BudgetListResponse;
    expect(result.data).toContainEqual(expect.objectContaining({
      category: expect.objectContaining({ id: 'category-health' }),
      period_type: 'CUSTOM', start_date: '2026-11-15', period_days: days,
    }));
  });

  it.each(['WEEKLY', 'MONTHLY'])('limpia los datos personalizados del envío al cambiar a %s', async (period) => {
    const submitted = vi.fn();
    server.use(http.post('*/api/v1/budgets', async ({ request }) => {
      submitted(await request.clone().json());
      // Sin respuesta: continúa hasta el manejador general de MSW.
    }));
    renderForm();
    const user = await fillForm();
    await user.selectOptions(screen.getByLabelText('Periodo'), 'CUSTOM');
    fireEvent.change(screen.getByLabelText('Fecha de inicio'), { target: { value: '2026-11-15' } });
    await user.selectOptions(screen.getByLabelText('Periodo'), period);
    expect(screen.queryByLabelText('Fecha de inicio')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));

    await waitFor(() => expect(screen.getByLabelText('ruta actual').textContent).toBe('/presupuestos'));
    expect(submitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      period_type: period, start_date: null, period_days: null,
    }));
  });

  it('cancela un formulario intacto sin pedir confirmación ni guardar', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const create = observeCreation();
    renderForm();
    await screen.findByLabelText('Categoría');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByLabelText('ruta actual').textContent).toBe('/presupuestos');
    expect(confirm).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('conserva los cambios si se rechaza descartarlos y no guarda al confirmar la salida', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const create = observeCreation();
    renderForm();
    const user = await fillForm();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(confirm).toHaveBeenCalledWith('¿Descartar los cambios del presupuesto?');
    expect(screen.getByLabelText('ruta actual').textContent).toBe('/presupuestos/nuevo');
    expect(screen.getByLabelText('Tope del periodo')).toHaveValue('100');

    await user.click(screen.getByRole('button', { name: 'Volver a presupuestos' }));
    expect(screen.getByLabelText('ruta actual').textContent).toBe('/presupuestos');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['crear', 'editar'])('bloquea el doble envío y la cancelación mientras termina de %s', async (action) => {
    const budget = action === 'editar' ? await createTestBudget() : undefined;
    const pending = deferred();
    const submitted = vi.fn();
    const observeSave = async ({ request }: { request: Request }) => {
      submitted(await request.clone().json());
      await pending.promise;
    };
    server.use(budget
      ? http.patch('*/api/v1/budgets/:id', observeSave)
      : http.post('*/api/v1/budgets', observeSave));
    renderForm(budget ? `/presupuestos/${budget.id}/editar` : '/presupuestos/nuevo');
    const user = userEvent.setup();
    if (!budget) await user.selectOptions(await screen.findByLabelText('Categoría'), 'category-health');
    const amount = await screen.findByLabelText('Tope del periodo');
    await user.clear(amount);
    await user.type(amount, '200');
    try {
      await user.dblClick(screen.getByRole('button', { name: budget ? 'Guardar cambios' : 'Crear presupuesto' }));
      await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Guardando…' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    } finally {
      pending.resolve();
    }

    await waitFor(() => expect(screen.getByLabelText('ruta actual').textContent).toBe('/presupuestos'));
    expect(submitted).toHaveBeenCalledTimes(1);
    if (budget) {
      expect(await readTestBudget(budget.id)).toMatchObject({ amount: '200.00' });
    } else {
      const result = await (await mockRequest('/budgets')).json() as BudgetListResponse;
      const health = result.data.filter((item) => item.category.id === 'category-health');
      expect(health).toHaveLength(1);
      expect(health[0]).toMatchObject({ amount: '200.00', status: 'ACTIVE' });
    }
  });
});

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { createTestBudget, mockRequest, readTestBudget } from '../../../test/cu07Cu08Api';
import { contractError, deferred, renderWithTestRouter } from '../../../test/cu01Cu02TestUtils';
import { resetFrontendState } from '../../../test/resetFrontendState';
import { BudgetsPage } from './BudgetsPage';

beforeEach(() => {
  resetFrontendState();
  localStorage.setItem('access_token', 'cu07-cu08-token');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return renderWithTestRouter(<BudgetsPage />, { path: '/presupuestos' });
}

describe('CU07 — listado y gestión de presupuestos con MSW', () => {
  it('muestra la carga y la sustituye por el listado al recibir la respuesta', async () => {
    const pending = deferred();
    server.use(http.get('*/api/v1/budgets', async () => { await pending.promise; }));
    renderPage();
    try {
      expect(screen.getByRole('status', { name: 'Cargando presupuestos' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Lista de presupuestos' })).not.toBeInTheDocument();
    } finally {
      pending.resolve();
    }

    expect(await screen.findByRole('region', { name: 'Lista de presupuestos' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Cargando presupuestos' })).not.toBeInTheDocument();
  });

  it.each([
    ['Activos', 'Aún no tienes presupuestos. Crea uno para controlar tus gastos.'],
    ['Inactivos', 'No tienes presupuestos inactivos.'],
  ])('presenta el estado vacío correspondiente al filtro %s', async (filter, message) => {
    server.use(http.get('*/api/v1/budgets', () => HttpResponse.json({ data: [] })));
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: filter }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Lista de presupuestos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: filter })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filtra activos e inactivos sin mezclar sus tarjetas ni incluir ingresos', async () => {
    await createTestBudget();
    const inactive = await createTestBudget({ category_id: 'category-other' });
    expect((await mockRequest(`/budgets/${inactive.id}`, 'DELETE')).status).toBe(204);
    renderPage();

    const activeList = await screen.findByRole('region', { name: 'Lista de presupuestos' });
    expect(within(activeList).getByRole('article', { name: 'Salud' })).toBeInTheDocument();
    const otherCategory = within(activeList).getByRole('article', { name: 'Otros' });
    expect(otherCategory).toHaveTextContent('Sin tope configurado');
    expect(otherCategory).toHaveTextContent('Gastado este mes');
    expect(otherCategory).toHaveTextContent('Sin gastos registrados');
    expect(within(activeList).queryByRole('heading', { name: 'Sueldo' })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Inactivos' }));
    const inactiveList = await screen.findByRole('region', { name: 'Lista de presupuestos' });
    expect(within(inactiveList).getAllByRole('article')).toHaveLength(1);
    expect(within(inactiveList).getByRole('article', { name: 'Otros' })).toHaveTextContent('Inactivo');
    expect(within(inactiveList).queryByRole('heading', { name: 'Salud' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activos' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('permite reintentar una carga fallida y recupera los datos de los mocks generales', async () => {
    server.use(http.get('*/api/v1/budgets', () => contractError(503, 'TEMPORARY_ERROR', 'No se pudieron consultar los topes.')));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron consultar los topes.');

    server.resetHandlers();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('region', { name: 'Lista de presupuestos' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('no envía DELETE ni cambia el presupuesto si se cancela su desactivación', async () => {
    const budget = await createTestBudget();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const remove = vi.fn();
    server.use(http.delete('*/api/v1/budgets/:id', () => { remove(); }));
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Desactivar presupuesto de Salud' }));

    expect(confirm).toHaveBeenCalledWith('¿Desactivar presupuesto?');
    expect(remove).not.toHaveBeenCalled();
    expect(await readTestBudget(budget.id)).toMatchObject({ status: 'ACTIVE' });
    expect(screen.queryByText('Presupuesto desactivado.')).not.toBeInTheDocument();
  });

  it('desactiva y reactiva un presupuesto conservando el monto y sus umbrales', async () => {
    const budget = await createTestBudget({ amount: '250.00', thresholds: [75, 90] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Desactivar presupuesto de Salud' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Presupuesto desactivado.');
    expect(screen.getByRole('article', { name: 'Salud' })).toHaveTextContent('Sin tope configurado');
    expect(await readTestBudget(budget.id)).toMatchObject({ status: 'INACTIVE', amount: '250.00' });

    await user.click(screen.getByRole('button', { name: 'Inactivos' }));
    await user.click(await screen.findByRole('button', { name: 'Reactivar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Presupuesto reactivado.');
    expect(await screen.findByText('No tienes presupuestos inactivos.')).toBeInTheDocument();
    const saved = await readTestBudget(budget.id);
    expect(saved).toMatchObject({ status: 'ACTIVE', amount: '250.00' });
    expect(saved.thresholds).toEqual(budget.thresholds);

    await user.click(screen.getByRole('button', { name: 'Activos' }));
    expect(await screen.findByRole('button', { name: 'Desactivar presupuesto de Salud' })).toBeInTheDocument();
  });

  it('no duplica la desactivación mientras la petición está pendiente', async () => {
    const budget = await createTestBudget();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const pending = deferred();
    const remove = vi.fn();
    server.use(http.delete('*/api/v1/budgets/:id', async () => {
      remove();
      await pending.promise;
    }));
    renderPage();
    try {
      await userEvent.setup().dblClick(await screen.findByRole('button', { name: 'Desactivar presupuesto de Salud' }));
      await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Desactivar presupuesto de Salud' })).toBeDisabled();
    } finally {
      pending.resolve();
    }

    expect(await screen.findByRole('status')).toHaveTextContent('Presupuesto desactivado.');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await readTestBudget(budget.id)).toMatchObject({ status: 'INACTIVE' });
  });

  it('mantiene el presupuesto activo ante un error de desactivación y permite reintentarlo', async () => {
    const budget = await createTestBudget();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(http.delete('*/api/v1/budgets/:id', () => contractError(503, 'TEMPORARY_ERROR', 'No se pudo desactivar.')));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Desactivar presupuesto de Salud' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo desactivar.');
    expect(await readTestBudget(budget.id)).toMatchObject({ status: 'ACTIVE' });
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Desactivar presupuesto de Salud' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Presupuesto desactivado.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('informa el conflicto de reactivación si ya existe otro tope activo para la categoría', async () => {
    const old = await createTestBudget();
    await mockRequest(`/budgets/${old.id}`, 'DELETE');
    const current = await createTestBudget({ amount: '200.00' });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Inactivos' }));
    await user.click(await screen.findByRole('button', { name: 'Reactivar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes un presupuesto para esta categoría.');
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeEnabled();
    expect(await readTestBudget(old.id)).toMatchObject({ status: 'INACTIVE', amount: '100.00' });
    expect(await readTestBudget(current.id)).toMatchObject({ status: 'ACTIVE', amount: '200.00' });
  });

  it('abre la edición del presupuesto seleccionado', async () => {
    const budget = await createTestBudget();
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Editar presupuesto de Salud' }));

    expect(screen.getByLabelText('ruta actual').textContent).toBe(`/presupuestos/${budget.id}/editar`);
  });
});

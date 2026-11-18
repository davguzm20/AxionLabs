import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { renderWithTestRouter } from '../../../test/cu01Cu02TestUtils';
import { BudgetFormPage } from './BudgetFormPage';

describe('BudgetFormPage', () => {
  it('muestra el catálogo completo y crea silenciosamente la categoría faltante', async () => {
    const createCategory = vi.fn();
    const createBudget = vi.fn();
    server.use(
      http.get('*/api/v1/categories', () => HttpResponse.json({ data: [
        { id: 'food', name: 'Alimentación', type: 'EXPENSE', icon: 'utensils' },
        { id: 'transport', name: 'Transporte', type: 'EXPENSE', icon: 'bus' },
        { id: 'health', name: 'Salud', type: 'EXPENSE', icon: 'heart-pulse' },
        { id: 'other', name: 'Otros', type: 'EXPENSE', icon: 'tag' },
      ] })),
      http.get('*/api/v1/budgets', () => HttpResponse.json({ data: [] })),
      http.post('*/api/v1/categories', async ({ request }) => {
        createCategory(await request.json());
        return HttpResponse.json({ id: 'services', name: 'Servicios', type: 'EXPENSE', icon: 'receipt' }, { status: 201 });
      }),
      http.post('*/api/v1/budgets', async ({ request }) => {
        createBudget(await request.json());
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithTestRouter(<BudgetFormPage />, { path: '/presupuestos/nuevo' });

    const category = await screen.findByLabelText('Categoría');
    expect(within(category).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Selecciona una categoría', 'Alimentación', 'Transporte', 'Servicios', 'Salud',
      'Ocio', 'Otros',
    ]);
    await user.selectOptions(category, 'catalog:Servicios');
    await user.type(screen.getByLabelText('Tope del periodo'), '100');
    await user.click(screen.getByRole('button', { name: 'Crear presupuesto' }));

    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: 'Servicios', type: 'EXPENSE' }));
    await waitFor(() => expect(createBudget).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'services' })));
  });
});

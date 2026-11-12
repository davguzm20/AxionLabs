import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { resetFrontendState } from '../../../test/resetFrontendState';
import { renderWithTestRouter } from '../../../test/cu01Cu02TestUtils';
import { ConfirmationCard, type Transaction } from './ConfirmationCard';

const transaction: Transaction = {
  id: 'transaction-cu05',
  type: 'EXPENSE',
  amount: '12.00',
  currency: 'PEN',
  concept: 'Café con leche',
  transaction_date: '2026-11-11',
  wallet_id: 'wallet-cu05',
  category: { id: 'food', name: 'Alimentación', icon: 'utensils', source: 'suggested' },
};

beforeEach(() => {
  resetFrontendState();
  localStorage.setItem('access_token', 'token-cu05');
});

describe('CU05 — corrección manual de categoría', () => {
  it('permite escoger del catálogo y envía PATCH con category_source manual', async () => {
    const patch = vi.fn();
    server.use(
      http.get('*/api/v1/categories', () => HttpResponse.json({ data: [
        { id: 'food', name: 'Alimentación', type: 'expense' },
        { id: 'transport', name: 'Transporte', type: 'expense' },
      ] })),
      http.patch('*/api/v1/transactions/transaction-cu05', async ({ request }) => {
        const body = await request.json();
        patch(body);
        return HttpResponse.json({ ...transaction, concept: 'Café para llevar', category: { id: 'transport', name: 'Transporte', icon: 'bus', source: 'manual' } });
      }),
    );

    const user = userEvent.setup();
    renderWithTestRouter(<ConfirmationCard transaction={transaction} walletName="Yape" status="confirmed" />);
    await user.click(screen.getByRole('button', { name: 'Cambiar categoría' }));
    await user.click(await screen.findByRole('button', { name: 'Transporte' }));
    const concept = screen.getByRole('textbox', { name: 'Concepto' });
    await user.clear(concept);
    await user.type(concept, 'Café para llevar');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(patch).toHaveBeenCalledExactlyOnceWith({
      concept: 'Café para llevar', category_id: 'transport', category_source: 'manual',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Categoría actualizada.');
    expect(screen.getByText('Transporte')).toBeInTheDocument();
  });

  it('muestra el error del servidor y mantiene abierto el formulario para reintentar', async () => {
    server.use(
      http.get('*/api/v1/categories', () => HttpResponse.json({ data: [
        { id: 'food', name: 'Alimentación', type: 'expense' },
        { id: 'transport', name: 'Transporte', type: 'expense' },
      ] })),
      http.patch('*/api/v1/transactions/transaction-cu05', () => HttpResponse.json({ error: { code: 'INVALID_CATEGORY', message: 'Categoría inválida.' } }, { status: 422 })),
    );
    const user = userEvent.setup();
    renderWithTestRouter(<ConfirmationCard transaction={transaction} walletName="Yape" status="confirmed" />);
    await user.click(screen.getByRole('button', { name: 'Cambiar categoría' }));
    await user.click(await screen.findByRole('button', { name: 'Transporte' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo actualizar la categoría. Inténtalo nuevamente.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { resetFrontendState } from '../../../test/resetFrontendState';
import {
  contractError, deferred, foodCategory, installTextHandlers, makeTextPreview,
  renderWithTestRouter, salaryCategory, testWallet, transportCategory,
} from '../../../test/cu01Cu02TestUtils';
import { TransactionPreviewCard } from './TransactionPreviewCard';

function renderPreview(overrides: Partial<Parameters<typeof TransactionPreviewCard>[0]> = {}) {
  const onEdit = vi.fn();
  const onConfirm = vi.fn();
  const view = renderWithTestRouter(<TransactionPreviewCard source="TEXT" preview={makeTextPreview()} isSaving={false} onEdit={onEdit} onConfirm={onConfirm} {...overrides} />);
  return { ...view, user: userEvent.setup(), onEdit, onConfirm };
}

beforeEach(() => {
  resetFrontendState();
  localStorage.setItem('access_token', 'token-cu02');
  installTextHandlers();
});

describe('CU02 — tarjeta de vista previa por texto', () => {
  it.each(['array', 'data'])('C02-PREV-01: presenta los datos y acepta catálogos con formato %s', async (format) => {
    const categoryRequests = vi.fn();
    const walletRequests = vi.fn();
    const categories = [{ ...foodCategory, type: 'expense' }];
    server.use(
      http.get('*/api/v1/categories', ({ request }) => {
        categoryRequests(new URL(request.url).searchParams.get('status'), request.headers.get('Authorization'));
        return HttpResponse.json(format === 'array' ? categories : { data: categories });
      }),
      http.get('*/api/v1/wallets', ({ request }) => {
        walletRequests(new URL(request.url).searchParams.get('status'));
        return HttpResponse.json(format === 'array' ? [testWallet] : { data: [testWallet] });
      }),
    );
    const { user, onConfirm } = renderPreview();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    const card = screen.getByRole('region', { name: 'Revisa tu transacción' });
    expect(within(card).getByText('S/ 15.00')).toBeInTheDocument();
    expect(within(card).getByText('Almuerzo')).toBeInTheDocument();
    expect(within(card).getByText('Alimentación')).toBeInTheDocument();
    expect(within(card).getByText('BCP')).toBeInTheDocument();
    expect(within(card).getByText(/15.*oct.*2026/i)).toBeInTheDocument();
    expect(categoryRequests).toHaveBeenCalledExactlyOnceWith('ACTIVE', 'Bearer token-cu02');
    expect(walletRequests).toHaveBeenCalledExactlyOnceWith('ACTIVE');
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      type: 'EXPENSE', amount: '15.00', currency: 'PEN', concept: 'Almuerzo', transaction_date: '2026-10-15',
      category_id: foodCategory.id, wallet_id: testWallet.id, merchant: '', ruc: '',
    });
  });

  it('C02-PREV-02: bloquea aceptar mientras se cargan las opciones', async () => {
    const pending = deferred();
    server.use(http.get('*/api/v1/categories', async () => {
      await pending.promise;
      return HttpResponse.json({ data: [{ ...foodCategory, type: 'expense' }] });
    }));
    const { user, onConfirm } = renderPreview();
    try {
      expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Aceptar' }));
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      pending.resolve();
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
  });

  it.each(['/categories', '/wallets'])('C02-PREV-03: informa una falla de %s y no permite guardar', async (path) => {
    server.use(http.get(`*/api/v1${path}`, () => contractError(503, 'SERVICE_UNAVAILABLE', 'Servicio no disponible.')));
    const { user, onConfirm } = renderPreview();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar categorías o monederos.');
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'sin monederos', wallets: [] },
    { name: 'monedero inactivo', wallets: [{ ...testWallet, status: 'INACTIVE' }] },
    { name: 'moneda incompatible', wallets: [{ ...testWallet, currency: 'USD' }] },
  ])('C02-PREV-04: $name no habilita el registro', async ({ wallets }) => {
    const loaded = vi.fn();
    server.use(http.get('*/api/v1/wallets', () => { loaded(); return HttpResponse.json({ data: wallets }); }));
    const { user, onConfirm } = renderPreview();
    await waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('C02-PREV-05: elige el monedero predeterminado si la extracción no indica uno', async () => {
    const preview = makeTextPreview({ wallet_id: undefined });
    server.use(http.get('*/api/v1/wallets', () => HttpResponse.json({ data: [
      { ...testWallet, id: 'otro-monedero', is_default: false }, testWallet,
    ] })));
    const { user, onConfirm } = renderPreview({ preview });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ wallet_id: testWallet.id });
  });

  it('C02-PREV-06: conserva la categoría de respaldo aunque no venga en el catálogo', async () => {
    const fallback = { id: 'category-other', name: 'Otros', type: 'EXPENSE' as const };
    const { user, onConfirm } = renderPreview({ preview: makeTextPreview({ category: fallback }) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    expect(screen.getByText('Otros')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ category_id: fallback.id });
  });

  it('C02-PREV-07: el editor solo ofrece categorías activas del tipo de movimiento', async () => {
    server.use(http.get('*/api/v1/categories', () => HttpResponse.json({ data: [
      { ...foodCategory, type: 'expense' }, { ...transportCategory, type: 'expense', status: 'INACTIVE' },
      { ...salaryCategory, type: 'income' },
    ] })));
    const { user } = renderPreview();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog');
    const categories = within(dialog).getByRole('group', { name: 'Elige una categoría' });
    expect(within(categories).getAllByRole('button').map((button) => button.textContent)).toEqual(['Alimentación']);
  });

  it('C02-PREV-08: normaliza las ediciones sin cambiar moneda, fecha ni monedero', async () => {
    const { user, onEdit, onConfirm } = renderPreview();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: '30.5' } });
    fireEvent.change(screen.getByLabelText(/^Concepto/i), { target: { value: '  Taxi a casa  ' } });
    await user.click(screen.getByRole('button', { name: 'Transporte' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const draft = {
      type: 'EXPENSE', amount: '30.50', currency: 'PEN', concept: 'Taxi a casa', transaction_date: '2026-10-15',
      wallet_id: testWallet.id, category_id: transportCategory.id, merchant: '', ruc: '',
    };
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0]?.[0]).toEqual(draft);
    expect(onEdit.mock.calls[0]?.[1]).toMatchObject(transportCategory);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(draft);
  });

  it('C02-PREV-09: cerrar el editor no cambia el borrador original', async () => {
    const { user, onEdit, onConfirm } = renderPreview();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: '90.00' } });
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('S/ 15.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ amount: '15.00', concept: 'Almuerzo', category_id: foodCategory.id });
  });

  it('C02-PREV-10: durante el guardado bloquea aceptar y editar', async () => {
    const { user, onEdit, onConfirm } = renderPreview({ isSaving: true });
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Guardando…' }));
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('C02-PREV-11: muestra el error de guardado sin perder el borrador', async () => {
    const { user, onConfirm } = renderPreview({ saveError: 'El monedero no está disponible.' });
    expect(screen.getByRole('alert')).toHaveTextContent('El monedero no está disponible.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ amount: '15.00', wallet_id: testWallet.id });
  });

  it('C02-PREV-12: muestra dólares y conserva el tipo ingreso recibido', async () => {
    const preview = makeTextPreview({ type: 'INCOME', currency: 'USD', category: salaryCategory });
    server.use(http.get('*/api/v1/wallets', () => HttpResponse.json({ data: [{ ...testWallet, currency: 'USD' }] })));
    const { user, onConfirm } = renderPreview({ preview });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    expect(screen.getByText('$ 15.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({ type: 'INCOME', currency: 'USD', category_id: salaryCategory.id });
  });

  it('DEFECTO CU02: una categoría de vista previa inactiva no debe habilitar aceptar', async () => {
    const inactive = { ...foodCategory, status: 'INACTIVE' };
    server.use(http.get('*/api/v1/categories', () => HttpResponse.json({ data: [{ ...inactive, type: 'expense' }] })));
    renderPreview({ preview: makeTextPreview({ category: inactive }) });
    // Esperar el monedero distingue el defecto real de la deshabilitación inicial por carga.
    await waitFor(() => expect(screen.getByText('BCP')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
  });
});

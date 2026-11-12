import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { resetWalletMocks } from '../../../mocks/handlers';
import { resetFrontendState } from '../../../test/resetFrontendState';
import { renderWithTestRouter } from '../../../test/cu01Cu02TestUtils';
import { WalletFormPage } from './WalletFormPage';

const validationMessages = {
  duplicate: 'El nombre del monedero ya está en uso. Por favor, escoja un nombre distinto',
  empty: 'El nombre del monedero no puede estar vacío. Por favor, escoja un nombre apropiado',
  balance: 'El saldo inicial debe ser un monto válido mayor o igual a S/ 0.00',
};

function renderForm() {
  return renderWithTestRouter(<WalletFormPage />, { path: '/monederos/nuevo' });
}

beforeEach(() => {
  resetFrontendState();
  resetWalletMocks();
  localStorage.setItem('access_token', 'token-cu06');
});

describe('CU06 — creación de monederos', () => {
  it('valida el nombre vacío con el mensaje contractual y no envía POST', async () => {
    const post = vi.fn();
    server.use(http.post('*/api/v1/wallets', ({ request }) => { post(request); return HttpResponse.json({}); }));
    const user = userEvent.setup();
    renderForm();
    await user.click(await screen.findByRole('button', { name: 'Crear monedero' }));
    expect(await screen.findByText(validationMessages.empty)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('rechaza un saldo negativo con el mensaje contractual y no envía POST', async () => {
    const post = vi.fn();
    server.use(http.post('*/api/v1/wallets', ({ request }) => { post(request); return HttpResponse.json({}); }));
    const user = userEvent.setup();
    renderForm();
    await user.type(await screen.findByLabelText('Nombre'), 'Billetera de la chamba');
    await user.clear(screen.getByLabelText('Saldo inicial'));
    await user.type(screen.getByLabelText('Saldo inicial'), '-0.01');
    await user.click(screen.getByRole('button', { name: 'Crear monedero' }));
    expect(await screen.findByText(validationMessages.balance)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('rechaza nombres repetidos ignorando mayúsculas y espacios', async () => {
    const post = vi.fn();
    server.use(http.post('*/api/v1/wallets', ({ request }) => { post(request); return HttpResponse.json({}); }));
    const user = userEvent.setup();
    renderForm();
    await user.type(await screen.findByLabelText('Nombre'), '  bCp  ');
    await user.click(screen.getByRole('button', { name: 'Crear monedero' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(validationMessages.duplicate);
    expect(post).not.toHaveBeenCalled();
  });

  it('envía nombre coloquial peruano y saldo normalizado; respeta is_default del primer monedero', async () => {
    let posted: Record<string, unknown> | undefined;
    server.use(
      http.get('*/api/v1/wallets', () => HttpResponse.json({ data: [] })),
      http.post('*/api/v1/wallets', async ({ request }) => {
        posted = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          wallet: { id: 'wallet-first', name: String(posted.name), type: 'CASH', currency: 'PEN', initial_balance: posted.initial_balance, balance: posted.initial_balance, is_default: true, status: 'ACTIVE' },
          confirmation_message: 'Monedero creado.',
        }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const view = renderForm();
    await user.type(await screen.findByLabelText('Nombre'), "Plata pa' la combi");
    await user.clear(screen.getByLabelText('Saldo inicial'));
    await user.type(screen.getByLabelText('Saldo inicial'), '12.3');
    await user.click(screen.getByRole('button', { name: 'Crear monedero' }));

    expect(await screen.findByText('/monederos')).toBeInTheDocument();
    expect(posted).toMatchObject({ name: "Plata pa' la combi", type: 'CASH', currency: 'PEN', initial_balance: '12.30' });
    expect(view.getByLabelText('ruta actual')).toHaveTextContent('/monederos');
  });

  it('presenta el error contractual que responde el servidor al duplicarse el nombre', async () => {
    server.use(http.post('*/api/v1/wallets', () => HttpResponse.json({ error: {
      code: 'WALLET_NAME_DUPLICATED', message: validationMessages.duplicate,
    } }, { status: 409 })));
    const user = userEvent.setup();
    renderForm();
    await user.type(await screen.findByLabelText('Nombre'), 'Mi alcancía');
    await user.click(screen.getByRole('button', { name: 'Crear monedero' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(validationMessages.duplicate);
  });

  it('presenta el error contractual del servidor para saldo inicial inválido', async () => {
    server.use(http.post('*/api/v1/wallets', () => HttpResponse.json({ error: {
      code: 'INITIAL_BALANCE_INVALID', message: validationMessages.balance,
    } }, { status: 422 })));
    const user = userEvent.setup();
    renderForm();
    await user.type(await screen.findByLabelText('Nombre'), 'Ahorrito para el finde');
    await user.click(screen.getByRole('button', { name: 'Crear monedero' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(validationMessages.balance));
  });
});

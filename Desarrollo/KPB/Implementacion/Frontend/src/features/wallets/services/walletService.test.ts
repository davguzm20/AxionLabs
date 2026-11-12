import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../../mocks/server';
import { resetFrontendState } from '../../../test/resetFrontendState';
import { resetWalletMocks } from '../../../mocks/handlers';
import { createWallet, getWallet, getWallets } from './walletService';

beforeEach(() => {
  resetFrontendState();
  resetWalletMocks();
  localStorage.setItem('access_token', 'token-cu06');
});

describe('CU06 — servicios de monederos', () => {
  it('lista y normaliza los tipos, saldos y estados recibidos', async () => {
    const wallets = await getWallets();
    expect(wallets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP', type: 'bank', balance: '185.00', is_default: true, status: 'ACTIVE' }),
    ]));
  });

  it('obtiene el detalle por id y codifica ids reservados en la ruta', async () => {
    await expect(getWallet('wallet-cash-default')).resolves.toMatchObject({ name: 'Efectivo', type: 'cash', currency: 'PEN' });
  });

  it('crea el primer monedero con saldo cero y recibe is_default true del API', async () => {
    resetWalletMocks([]);
    const created = await createWallet({ name: 'Mi Yape', type: 'cash', currency: 'PEN', initial_balance: '0.00' });
    expect(created.wallet).toMatchObject({ name: 'Mi Yape', is_default: true, balance: '0.00' });
    expect(created.confirmation_message).toContain('Mi Yape');
  });

  it.each([
    ['WALLET_NAME_EMPTY', 'El nombre del monedero no puede estar vacío. Por favor, escoja un nombre apropiado'],
    ['WALLET_NAME_DUPLICATED', 'El nombre del monedero ya está en uso. Por favor, escoja un nombre distinto'],
    ['INITIAL_BALANCE_INVALID', 'El saldo inicial debe ser un monto válido mayor o igual a S/ 0.00'],
  ])('propaga el error contractual del servidor %s', async (code, message) => {
    server.use(http.post('*/api/v1/wallets', () => HttpResponse.json({ error: { code, message } }, { status: 422 })));
    await expect(createWallet({ name: 'Mi monedero', type: 'cash', currency: 'PEN', initial_balance: '0.00' }))
      .rejects.toMatchObject({ code, message });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { resetFrontendState } from '../../test/resetFrontendState';
import { ChatPage } from './ChatPage';

vi.mock('../notifications/components/NotificationBell', () => ({ NotificationBell: () => null }));
const API = 'http://localhost/api/v1';
const ERROR_MESSAGE = 'No pude identificar el monto. ¿Cuánto fue el gasto/ingreso?';
function renderChat() {
  localStorage.setItem('access_token', 'token-cu02');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><ChatPage /></MemoryRouter></QueryClientProvider>);
}
async function send(text: string) {
  const user = userEvent.setup(); renderChat();
  fireEvent.change(screen.getByRole('textbox', { name: /gastos o ingresos/i }), { target: { value: text } });
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  return user;
}
function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, details: [], trace_id: `req_${code}` } }, { status });
}
async function apiGet(path: string) {
  return fetch(`${API}${path}`, { headers: { Authorization: 'Bearer token-cu02' } });
}
beforeEach(() => resetFrontendState());

describe('CU02 — texto libre', () => {
  it('C02-01: extrae sin mutar presupuestos, saldos ni transacciones', async () => {
    let extractions = 0; let posts = 0;
    server.use(http.post('*/api/v1/extractions/text', () => { extractions++; return HttpResponse.json({ preview_id: 'preview-1', extracted: { type: 'EXPENSE', amount: '15.00', currency: 'PEN', concept: 'almuerzo', transaction_date: new Date().toISOString().slice(0, 10), category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'EXPENSE' } }, confidence: .99, requires_confirmation: true }); }),
      http.post('*/api/v1/transactions', () => { posts++; return HttpResponse.json({}); }));
    const budgetsBefore = localStorage.getItem('mock_budgets_v2');
    const walletsBefore = await apiGet('/wallets').then((response) => response.json());
    const transactionsBefore = await apiGet('/transactions').then((response) => response.json());
    await send('gasté 15 soles en almuerzo');
    expect(await screen.findByText('Revisa tu transacción')).toBeInTheDocument();
    expect(extractions).toBe(1); expect(posts).toBe(0);
    expect(localStorage.getItem('mock_budgets_v2')).toBe(budgetsBefore);
    expect(await apiGet('/wallets').then((response) => response.json())).toEqual(walletsBefore);
    expect(await apiGet('/transactions').then((response) => response.json())).toEqual(transactionsBefore);
  });

  it('C02-02: acepta una vez con monto string y categoría, y la tarjeta guardada solo ofrece historial', async () => {
    let body: Record<string, unknown> | undefined; let calls = 0;
    server.use(http.post('*/api/v1/transactions', async ({ request }) => { calls++; body = await request.json() as Record<string, unknown>; return HttpResponse.json({ transaction: { id: 'saved-1', type: 'expense', amount: '15.00', currency: 'PEN', concept: 'almuerzo', category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', source: 'suggested' }, wallet: { id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP' }, occurred_at: new Date().toISOString(), source: 'text' }, budget_alert: null }); }));
    const user = await send('gasté 15 soles en almuerzo'); await user.click(await screen.findByRole('button', { name: 'Aceptar' }));
    await waitFor(() => expect(calls).toBe(1)); expect(typeof body?.amount).toBe('string'); expect(body?.amount).toBe('15.00'); expect(body).toHaveProperty('category_source');
    expect(await screen.findByRole('link', { name: 'Ver historial' })).toBeInTheDocument();
    // DEFECTO-CONTRATO: el flujo aprobado envía source "text"; API-10 solo admite voice, receipt o manual.
  });

  it('C02-03: presenta ingreso en la vista previa y envía type income al aceptar', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(http.post('*/api/v1/transactions', async ({ request }) => { body = await request.json() as Record<string, unknown>; return HttpResponse.json({ transaction: { id: 'income-1', type: 'income', amount: '15.00', currency: 'PEN', concept: 'sueldo', category: { id: 'category-salary', name: 'Sueldo', source: 'suggested' }, wallet: { id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP' }, occurred_at: new Date().toISOString(), source: 'text' }, budget_alert: null }); }));
    const user = await send('recibí 15 soles de sueldo');
    expect(await screen.findByText(/S\/\s*15\.00/)).toBeInTheDocument();
    const card = screen.getByRole('heading', { name: 'Revisa tu transacción' }).parentElement!;
    expect(within(card).getAllByText('Sueldo').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    await waitFor(() => expect(body?.type).toBe('income'));
  });

  it('C02-04: muestra el error contractual de monto y no presenta tarjeta', async () => {
    server.use(http.post('*/api/v1/extractions/text', () => apiError(422, 'AMOUNT_NOT_DETECTED', ERROR_MESSAGE)));
    await send('gasté en almuerzo'); expect(await screen.findByText(ERROR_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('Revisa tu transacción')).not.toBeInTheDocument();
  });

  it('C02-05a: muestra exactamente el mensaje contractual del servicio caído', async () => {
    server.use(http.post('*/api/v1/extractions/text', () => apiError(503, 'NLP_UNAVAILABLE', 'El servicio no está disponible. Por favor intente nuevamente')));
    await send('falla 15 soles'); expect(await screen.findByText('El servicio no está disponible. Por favor intente nuevamente')).toBeInTheDocument();
  });

  it('C02-05b: ofrece reintentar ante NLP_UNAVAILABLE', async () => {
    server.use(http.post('*/api/v1/extractions/text', () => apiError(503, 'NLP_UNAVAILABLE', 'El servicio no está disponible. Por favor intente nuevamente')));
    await send('falla 15 soles'); expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('C02-06a: texto vacío no se envía', async () => {
    let calls = 0; server.use(http.post('*/api/v1/extractions/text', () => { calls++; return HttpResponse.json({}); }));
    const user = userEvent.setup(); renderChat(); await user.click(screen.getByRole('button', { name: 'Enviar' })); expect(calls).toBe(0);
  });

  it('C02-06b: texto de exactamente 500 caracteres se envía', async () => {
    let received = ''; server.use(http.post('*/api/v1/extractions/text', async ({ request }) => { received = ((await request.json()) as { text: string }).text; return apiError(422, 'AMOUNT_NOT_DETECTED', ERROR_MESSAGE); }));
    const user = userEvent.setup(); renderChat(); const input = screen.getByRole('textbox', { name: /gastos o ingresos/i });
    fireEvent.change(input, { target: { value: `15 ${'x'.repeat(497)}` } }); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(received).toHaveLength(500));
  });

  it('C02-06c: texto de 501 caracteres muestra aviso y no se envía', async () => {
    let calls = 0; server.use(http.post('*/api/v1/extractions/text', () => { calls++; return HttpResponse.json({}); }));
    const user = userEvent.setup(); renderChat(); const input = screen.getByRole('textbox', { name: /gastos o ingresos/i });
    fireEvent.change(input, { target: { value: `15 ${'x'.repeat(498)}` } }); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El texto no puede superar 500 caracteres.'); expect(calls).toBe(0);
  });

  it('C02-07: edición actualiza la vista previa sin HTTP adicional', async () => {
    let calls = 0; server.use(http.post('*/api/v1/extractions/text', () => { calls++; return HttpResponse.json({ preview_id: 'p', extracted: { type: 'EXPENSE', amount: '15.00', currency: 'PEN', concept: 'almuerzo', transaction_date: new Date().toISOString().slice(0, 10), category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'EXPENSE' } }, confidence: .9, requires_confirmation: true }); }), http.get('*/api/v1/categories', () => HttpResponse.json([{ id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'expense' }])), http.get('*/api/v1/wallets', () => HttpResponse.json([{ id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP', currency: 'PEN', is_default: true }])));
    const user = await send('gasté 15 soles en almuerzo'); await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog'); expect(within(dialog).getAllByRole('textbox')).toHaveLength(2); expect(within(dialog).getByRole('group', { name: 'Elige una categoría' })).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Concepto')); await user.type(within(dialog).getByLabelText('Concepto'), 'cena'); await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByText('cena')).toBeInTheDocument(); expect(calls).toBe(1);
  });

  it('C02-08: valida monto vacío e inválido y concepto vacío en el modal', async () => {
    const user = await send('gasté 15 soles en almuerzo'); await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog'); const amount = within(dialog).getByLabelText(/^Monto/i); const concept = within(dialog).getByLabelText(/^Concepto/i);
    await user.clear(amount); await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa un monto válido con hasta dos decimales.');
    await user.type(amount, 'abc'); await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa un monto válido con hasta dos decimales.');
    await user.clear(amount); await user.type(amount, '15'); await user.clear(concept); await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa un concepto.');
  });

  it('C02-08b: rechaza monto cero en el modal', async () => {
    const user = await send('gasté 15 soles en almuerzo'); await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog'); const amount = within(dialog).getByLabelText(/^Monto/i);
    await user.clear(amount); await user.type(amount, '0'); await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa un monto válido con hasta dos decimales.');
  });

  it('C02-09: categoría editada se envía como manual con su category_id', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(http.get('*/api/v1/categories', () => HttpResponse.json([{ id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'expense' }, { id: 'category-transport', name: 'Transporte', type: 'expense' }])), http.get('*/api/v1/wallets', () => HttpResponse.json([{ id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP', currency: 'PEN', is_default: true }])), http.post('*/api/v1/transactions', async ({ request }) => { body = await request.json() as Record<string, unknown>; return HttpResponse.json({ transaction: { id: 'edited', type: 'expense', amount: '15.00', currency: 'PEN', concept: 'almuerzo', category: { id: 'category-transport', name: 'Transporte', source: 'manual' }, wallet: { id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP' }, occurred_at: new Date().toISOString(), source: 'text' }, budget_alert: null }); }));
    const user = await send('gasté 15 soles en almuerzo'); await user.click(await screen.findByRole('button', { name: 'Editar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Transporte' })); await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambios' })); await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    await waitFor(() => expect(body).toMatchObject({ category_id: 'category-transport', category_source: 'manual' }));
  });

  it('C02-10: doble clic en Aceptar produce un solo POST', async () => {
    let calls = 0; server.use(http.post('*/api/v1/transactions', async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 30)); return HttpResponse.json({ transaction: { id: 'one', type: 'expense', amount: '15.00', currency: 'PEN', concept: 'almuerzo', category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', source: 'suggested' }, wallet: { id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP' }, occurred_at: new Date().toISOString(), source: 'text' }, budget_alert: null }); }));
    const user = await send('gasté 15 soles en almuerzo'); const accept = await screen.findByRole('button', { name: 'Aceptar' }); await user.dblClick(accept); await waitFor(() => expect(calls).toBe(1));
  });

  async function previewWithAmount(user: ReturnType<typeof userEvent.setup>, amount: string, category = 'Alimentación') {
    server.use(http.post('*/api/v1/extractions/text', () => HttpResponse.json({ preview_id: `p-${amount}`, extracted: { type: 'EXPENSE', amount, currency: 'PEN', concept: 'gasto de prueba', transaction_date: new Date().toISOString().slice(0, 10), category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'EXPENSE' } }, confidence: .99, requires_confirmation: true })),
      http.get('*/api/v1/categories', () => HttpResponse.json([{ id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'expense' }, { id: 'category-transport', name: 'Transporte', type: 'expense' }, { id: 'category-health', name: 'Salud', type: 'expense' }])),
      http.get('*/api/v1/wallets', () => HttpResponse.json([{ id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP', currency: 'PEN', is_default: true }])));
    fireEvent.change(screen.getByRole('textbox', { name: /gastos o ingresos/i }), { target: { value: 'gasto de prueba' } }); await user.click(screen.getByRole('button', { name: 'Enviar' }));
    await screen.findByRole('button', { name: 'Aceptar' });
    if (category !== 'Alimentación') { await user.click(screen.getByRole('button', { name: 'Editar' })); await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: category })); await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambios' })); }
  }

  it('C02-11: gasto de 200.00 cruza 80% y muestra alerta normal contractual', async () => {
    const user = userEvent.setup(); renderChat(); await previewWithAmount(user, '200.00'); await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByText('Alerta de presupuesto')).toBeInTheDocument();
    const alert = screen.getByText('Alerta de presupuesto').parentElement!.parentElement!;
    expect(within(alert).getByText(/Gastado: S\/ 200\.00 de S\/ 250\.00/)).toBeInTheDocument();
    expect(within(alert).getByText(/Te quedan S\/ 50\.00/)).toBeInTheDocument();
    expect((await apiGet('/budgets?category_id=f61d5fcc-730a-48d9-81dc-1db75ce4af16').then((r) => r.json()) as { data: Array<{ consumed: string; percentage: number }> }).data[0]).toMatchObject({ consumed: '200.00', percentage: 80 });
  });

  it('C02-12: gasto posterior supera 250.00 y muestra alerta excedida', async () => {
    const user = userEvent.setup(); renderChat(); await previewWithAmount(user, '200.00'); await user.click(screen.getByRole('button', { name: 'Aceptar' })); await screen.findByText('Alerta de presupuesto');
    await previewWithAmount(user, '60.00'); await user.click(screen.getByRole('button', { name: 'Aceptar' })); expect(await screen.findByText('¡Presupuesto excedido!')).toBeInTheDocument();
  });

  // SUPOSICIÓN: el contrato no define si un gasto ya excedido genera nueva alerta (pregunta 4b)
  it('C02-13: verifica respuesta tras gasto en presupuesto Transporte ya excedido', async () => {
    const user = userEvent.setup(); renderChat(); await previewWithAmount(user, '15.00', 'Transporte'); await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    await waitFor(async () => expect((await apiGet('/budgets?category_id=category-transport').then((r) => r.json()) as { data: Array<{ consumed: string }> }).data[0]?.consumed).toBe('84.80'));
    expect(screen.queryByText('Alerta de presupuesto')).not.toBeInTheDocument();
  });

  it('C02-14: categoría Salud sin tope devuelve budget_alert null', async () => {
    const user = userEvent.setup(); renderChat(); await previewWithAmount(user, '15.00', 'Salud');
    const save = vi.fn();
    server.use(http.post('*/api/v1/transactions', async ({ request }) => {
      save(await request.json());
      return HttpResponse.json({ transaction: { id: 'health', type: 'expense', amount: '15.00', currency: 'PEN', concept: 'gasto de prueba', category: { id: 'category-health', name: 'Salud', source: 'manual' }, wallet: { id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP' }, occurred_at: new Date().toISOString(), source: 'text' }, budget_alert: null });
    }));
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ category_id: 'category-health', amount: '15.00' });
    expect(screen.queryByText('Alerta de presupuesto')).not.toBeInTheDocument();
    expect(screen.queryByText('¡Presupuesto excedido!')).not.toBeInTheDocument();
  });

  it('C02-15: presupuesto e historial reflejan consumo y porcentaje coherentes', async () => {
    const user = userEvent.setup(); renderChat(); await previewWithAmount(user, '200.00'); await user.click(screen.getByRole('button', { name: 'Aceptar' })); await screen.findByText('Alerta de presupuesto');
    const budget = (await apiGet('/budgets?category_id=f61d5fcc-730a-48d9-81dc-1db75ce4af16').then((r) => r.json()) as { data: Array<{ consumed: string; percentage: number }> }).data[0];
    const history = (await apiGet('/transactions?category_id=f61d5fcc-730a-48d9-81dc-1db75ce4af16').then((r) => r.json()) as { data?: Array<{ amount: string }>; items?: Array<{ amount: string }> });
    expect(budget).toMatchObject({ consumed: '200.00', percentage: 80 }); expect(history.data ?? history.items).toContainEqual(expect.objectContaining({ amount: '200.00' }));
  });
});

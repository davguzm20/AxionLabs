import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { resetFrontendState } from '../../test/resetFrontendState';
import {
  contractError, deferred, foodCategory, installTextHandlers, makeSavedTextResponse,
  makeTextPreview, renderWithTestRouter, testWallet, transportCategory,
} from '../../test/cu01Cu02TestUtils';
import { LoginPage } from '../auth/LoginPage';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { SessionExpiryHandler } from '../auth/SessionExpiryHandler';
import { ChatPage } from './ChatPage';

vi.mock('../notifications/components/NotificationBell', () => ({ NotificationBell: () => null }));

function renderChat() {
  return renderWithTestRouter(
    <>
      <SessionExpiryHandler />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}><Route path="/inicio" element={<ChatPage />} /></Route>
        <Route path="/historial" element={<h1>Historial de prueba</h1>} />
        <Route path="/presupuestos" element={<h1>Presupuestos de prueba</h1>} />
      </Routes>
    </>,
  );
}

async function sendText(text = 'gasté 15 soles en almuerzo', user = userEvent.setup()) {
  fireEvent.change(screen.getByRole('textbox', { name: /gastos o ingresos/i }), { target: { value: text } });
  await user.click(screen.getByRole('button', { name: 'Enviar' }));
  return user;
}

async function acceptPreview(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Aceptar' }));
}

beforeEach(() => {
  resetFrontendState();
  localStorage.setItem('access_token', 'token-cu02');
  installTextHandlers();
});
afterEach(() => vi.restoreAllMocks());

describe('CU02 — peticiones, recuperación de errores y persistencia del frontend', () => {
  it('C02-RES-01: sin sesión no muestra el chat ni hace peticiones de extracción', async () => {
    localStorage.removeItem('access_token');
    const extract = vi.fn();
    server.use(http.post('*/api/v1/extractions/text', () => { extract(); return HttpResponse.json(makeTextPreview()); }));
    renderChat();
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /gastos o ingresos/i })).not.toBeInTheDocument();
    expect(extract).not.toHaveBeenCalled();
  });

  it('C02-RES-02: limpia espacios y envía Enter, pero Shift+Enter no envía', async () => {
    const user = userEvent.setup();
    const extract = vi.fn();
    server.use(http.post('*/api/v1/extractions/text', async ({ request }) => {
      extract(await request.json());
      return HttpResponse.json(makeTextPreview());
    }));
    renderChat();
    const input = screen.getByRole('textbox', { name: /gastos o ingresos/i });
    await user.type(input, '  gasté 15 soles  ');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(extract).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Revisa tu transacción' })).toBeInTheDocument();
    expect(extract).toHaveBeenCalledExactlyOnceWith({ text: 'gasté 15 soles', client_timezone: 'America/Lima' });
    expect(input).toHaveValue('');
  });

  it('C02-RES-03: los espacios no se envían y un mensaje de 499 caracteres sí', async () => {
    const extract = vi.fn();
    server.use(http.post('*/api/v1/extractions/text', async ({ request }) => {
      extract(await request.json());
      return HttpResponse.json(makeTextPreview());
    }));
    renderChat();
    const user = await sendText('   ');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    expect(extract).not.toHaveBeenCalled();
    const text = `15 ${'x'.repeat(496)}`;
    await sendText(text, user);
    expect(await screen.findByRole('heading', { name: 'Revisa tu transacción' })).toBeInTheDocument();
    expect(extract).toHaveBeenCalledExactlyOnceWith({ text, client_timezone: 'America/Lima' });
  });

  it('C02-RES-04: mientras extrae bloquea la entrada y no duplica peticiones', async () => {
    const pending = deferred();
    const extract = vi.fn();
    server.use(http.post('*/api/v1/extractions/text', async ({ request }) => {
      extract(await request.json());
      await pending.promise;
      return HttpResponse.json(makeTextPreview());
    }));
    renderChat();
    const user = userEvent.setup();
    fireEvent.change(screen.getByRole('textbox', { name: /gastos o ingresos/i }), { target: { value: 'gasté 15 soles' } });
    try {
      await user.dblClick(screen.getByRole('button', { name: 'Enviar' }));
      await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('textbox', { name: /gastos o ingresos/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('preparando la transacción');
    } finally {
      pending.resolve();
    }
    expect(await screen.findByRole('heading', { name: 'Revisa tu transacción' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /gastos o ingresos/i })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('C02-RES-05: reintenta el mismo texto tras NLP_UNAVAILABLE sin registrar antes de aceptar', async () => {
    const extract = vi.fn();
    const save = vi.fn();
    server.use(
      http.post('*/api/v1/extractions/text', async ({ request }) => {
        extract(await request.json());
        return extract.mock.calls.length === 1
          ? contractError(503, 'NLP_UNAVAILABLE', 'El servicio no está disponible. Por favor intente nuevamente')
          : HttpResponse.json(makeTextPreview());
      }),
      http.post('*/api/v1/transactions', () => { save(); return HttpResponse.json(makeSavedTextResponse(), { status: 201 }); }),
    );
    renderChat();
    const user = await sendText();
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Revisa tu transacción' })).toBeInTheDocument();
    expect(extract.mock.calls).toEqual([
      [{ text: 'gasté 15 soles en almuerzo', client_timezone: 'America/Lima' }],
      [{ text: 'gasté 15 soles en almuerzo', client_timezone: 'America/Lima' }],
    ]);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'red', response: () => HttpResponse.error() },
    { name: 'respuesta no JSON', response: () => HttpResponse.text('Temporalmente no disponible', { status: 503 }) },
  ])('C02-RES-06: una falla de $name en extracción recupera los controles sin guardar', async ({ response }) => {
    const save = vi.fn();
    server.use(
      http.post('*/api/v1/extractions/text', response),
      http.post('*/api/v1/transactions', () => { save(); return HttpResponse.json(makeSavedTextResponse()); }),
    );
    renderChat();
    await sendText();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /gastos o ingresos/i })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Revisa tu transacción' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Transacción registrada' })).not.toBeInTheDocument();
    expect(screen.getByRole('log')).not.toHaveTextContent('undefined');
    expect(save).not.toHaveBeenCalled();
  });

  it('C02-RES-07: envía el contrato completo con token, fecha de Lima y categoría sugerida', async () => {
    const save = vi.fn();
    server.use(http.post('*/api/v1/transactions', async ({ request }) => {
      save({ body: await request.json(), authorization: request.headers.get('Authorization'), contentType: request.headers.get('Content-Type'), key: request.headers.get('Idempotency-Key') });
      return HttpResponse.json(makeSavedTextResponse(), { status: 201 });
    }));
    renderChat();
    const user = await sendText();
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      body: {
        type: 'expense', amount: '15.00', currency: 'PEN', concept: 'Almuerzo', occurred_at: '2026-10-15T12:00:00-05:00',
        wallet_id: testWallet.id, category_id: foodCategory.id, source: 'text', category_source: 'suggested',
      },
      authorization: 'Bearer token-cu02', contentType: 'application/json',
      key: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i),
    });
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver historial' })).toHaveAttribute('href', '/historial');
  });

  it('C02-RES-08: envía las ediciones locales una sola vez y como categoría manual', async () => {
    const save = vi.fn();
    const extract = vi.fn();
    const edited = makeTextPreview({ amount: '30.50', concept: 'Taxi a casa', category: transportCategory });
    server.use(
      http.post('*/api/v1/extractions/text', () => { extract(); return HttpResponse.json(makeTextPreview()); }),
      http.post('*/api/v1/transactions', async ({ request }) => {
        save(await request.json());
        return HttpResponse.json(makeSavedTextResponse(edited), { status: 201 });
      }),
    );
    renderChat();
    const user = await sendText();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: '30.5' } });
    fireEvent.change(screen.getByLabelText(/^Concepto/i), { target: { value: '  Taxi a casa  ' } });
    await user.click(screen.getByRole('button', { name: 'Transporte' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(save).not.toHaveBeenCalled();
    expect(extract).toHaveBeenCalledTimes(1);
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      type: 'expense', amount: '30.50', currency: 'PEN', concept: 'Taxi a casa', occurred_at: '2026-10-15T12:00:00-05:00',
      wallet_id: testWallet.id, category_id: transportCategory.id, source: 'text', category_source: 'manual',
    });
  });

  it.each([
    [404, 'WALLET_NOT_FOUND', 'El monedero no existe.'],
    [422, 'INVALID_CATEGORY', 'Selecciona una categoría válida.'],
    [422, 'CURRENCY_MISMATCH', 'La moneda no coincide con el monedero.'],
    [409, 'NO_ACTIVE_WALLET', 'Crea un monedero antes de registrar.'],
    [503, 'SERVICE_UNAVAILABLE', 'No se pudo registrar el movimiento.'],
  ])('C02-RES-09: el rechazo %i/%s conserva el borrador y permite reintentar', async (status, code, message) => {
    const save = vi.fn();
    server.use(http.post('*/api/v1/transactions', async ({ request }) => {
      save(await request.json());
      return contractError(status, code, message);
    }));
    renderChat();
    const user = await sendText();
    await acceptPreview(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('heading', { name: 'Revisa tu transacción' })).toBeInTheDocument();
    expect(screen.getByText('S/ 15.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Transacción registrada' })).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/inicio');
  });

  it.each([
    { name: 'red', failure: () => HttpResponse.error() },
    { name: 'respuesta no JSON', failure: () => HttpResponse.text('No disponible', { status: 502 }) },
  ])('C02-RES-10: el reintento tras falla de $name conserva payload y clave de idempotencia', async ({ failure }) => {
    const requests: Array<{ body: unknown; key: string | null }> = [];
    server.use(http.post('*/api/v1/transactions', async ({ request }) => {
      requests.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
      return requests.length === 1 ? failure() : HttpResponse.json(makeSavedTextResponse(), { status: 201 });
    }));
    renderChat();
    const user = await sendText();
    await acceptPreview(user);
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'Transacción registrada' })).not.toBeInTheDocument();
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.key).toEqual(expect.any(String));
    expect(requests[1]).toEqual(requests[0]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('C02-RES-11: un guardado pendiente deshabilita acciones y un doble clic no lo duplica', async () => {
    const pending = deferred();
    const save = vi.fn();
    server.use(http.post('*/api/v1/transactions', async ({ request }) => {
      save(await request.json());
      await pending.promise;
      return HttpResponse.json(makeSavedTextResponse(), { status: 201 });
    }));
    renderChat();
    const user = await sendText();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    try {
      await user.dblClick(screen.getByRole('button', { name: 'Aceptar' }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Editar' })).toBeDisabled();
      expect(screen.queryByRole('heading', { name: 'Transacción registrada' })).not.toBeInTheDocument();
    } finally {
      pending.resolve();
    }
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('C02-RES-12: dos transacciones diferentes usan claves diferentes', async () => {
    let previews = 0;
    const keys: Array<string | null> = [];
    server.use(
      http.post('*/api/v1/extractions/text', () => HttpResponse.json(makeTextPreview({}, { preview_id: `preview-${++previews}` }))),
      http.post('*/api/v1/transactions', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(makeSavedTextResponse(makeTextPreview({}, { preview_id: `preview-${keys.length}` })), { status: 201 });
      }),
    );
    renderChat();
    const user = await sendText();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    await sendText('otro gasto de 15 soles', user);
    await acceptPreview(user);
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'Transacción registrada' })).toHaveLength(2));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toEqual(expect.any(String));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('C02-RES-13: al guardar invalida las consultas financieras sin alterar datos ajenos', async () => {
    const { queryClient } = renderChat();
    const keys = ['budgets', 'notifications', 'transactions', 'wallets', 'dashboard'];
    for (const key of [...keys, 'preferencias-ajenas']) queryClient.setQueryData([key], { previo: true });
    const user = await sendText();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    for (const key of keys) expect(queryClient.getQueryState([key])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['preferencias-ajenas'])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(['preferencias-ajenas'])).toEqual({ previo: true });
  });

  it.each([
    { priority: 'normal' as const, percentage: 80, title: 'Alerta de presupuesto' },
    { priority: 'high' as const, percentage: 100, title: '¡Presupuesto excedido!' },
  ])('C02-RES-14: presenta la alerta $priority recibida sin calcular el presupuesto en el cliente', async ({ priority, percentage, title }) => {
    const response = makeSavedTextResponse();
    response.budget_alert = {
      notification_id: 'alert-cu02-1', category: { id: foodCategory.id, name: foodCategory.name },
      threshold_percentage: percentage, usage_percentage: percentage + 5, remaining: '-5.00', priority,
      message: `Aviso del servidor: consumo ${percentage + 5}% en Alimentación.`,
    };
    installTextHandlers(makeTextPreview(), response);
    renderChat();
    const user = await sendText();
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(response.budget_alert.message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver presupuesto' })).toHaveAttribute('href', '/presupuestos');
    expect(screen.getAllByRole('heading', { name: 'Transacción registrada' })).toHaveLength(1);
  });

  it('C02-RES-15: budget_alert null confirma sin mostrar una alerta', async () => {
    renderChat();
    const user = await sendText();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(screen.queryByRole('heading', { name: 'Alerta de presupuesto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '¡Presupuesto excedido!' })).not.toBeInTheDocument();
  });

  it.each(['extraer', 'guardar'])('C02-RES-16: sesión expirada al %s revoca el token, limpia caché y redirige sin confirmar', async (step) => {
    server.use(http.post(step === 'extraer' ? '*/api/v1/extractions/text' : '*/api/v1/transactions', () => contractError(401, 'SESSION_EXPIRED', 'Tu sesión expiró.')));
    const { queryClient } = renderChat();
    queryClient.setQueryData(['datos-privados'], { saldo: 'privado' });
    const user = await sendText();
    if (step === 'guardar') await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Tu sesión expiró. Inicia sesión nuevamente.');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Transacción registrada' })).not.toBeInTheDocument();
  });

  // La limpieza aislada de sesión sí funciona (session.test.tsx); la escritura
  // posterior del catch/useEffect del chat vuelve a persistir los datos privados.
  it.fails.each(['extraer', 'guardar'])('DEFECTO CU02: no vuelve a guardar el chat después de expirar la sesión al %s', async (step) => {
    server.use(http.post(step === 'extraer' ? '*/api/v1/extractions/text' : '*/api/v1/transactions', () => contractError(401, 'SESSION_EXPIRED', 'Tu sesión expiró.')));
    renderChat();
    const user = await sendText('gasto privado de 15 soles');
    if (step === 'guardar') await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Inicia sesión' });
    expect(localStorage.getItem('khipubot_chat_messages')).toBeNull();
  });

  it('C02-RES-17: restaura una confirmación sin volver a guardar y permite abrir historial', async () => {
    const save = vi.fn();
    server.use(http.post('*/api/v1/transactions', () => { save(); return HttpResponse.json(makeSavedTextResponse(), { status: 201 }); }));
    const view = renderChat();
    const user = await sendText();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    const stored = JSON.parse(localStorage.getItem('khipubot_chat_messages') ?? '[]') as Array<{ kind: string; status?: string }>;
    expect(stored).toContainEqual(expect.objectContaining({ kind: 'confirmation', status: 'confirmed' }));
    view.unmount();
    renderChat();
    expect(screen.getByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Ver historial' }));
    expect(await screen.findByRole('heading', { name: 'Historial de prueba' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('C02-RES-18: una vista previa restaurada no queda guardando ni se envía automáticamente', async () => {
    localStorage.setItem('khipubot_chat_messages', JSON.stringify([{
      id: 'preview-cu02-1', kind: 'preview', source: 'TEXT', preview: makeTextPreview(),
      suggestedCategoryId: foodCategory.id, isSaving: true,
    }]));
    const save = vi.fn();
    server.use(http.post('*/api/v1/transactions', () => { save(); return HttpResponse.json(makeSavedTextResponse(), { status: 201 }); }));
    renderChat();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Guardando…' })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Aceptar' }));
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each(['{', 'null', '{"no":"es una lista"}'])('C02-RES-19: ignora el historial local inválido %j y permite escribir', (stored) => {
    localStorage.setItem('khipubot_chat_messages', stored);
    renderChat();
    expect(screen.getByRole('log')).toHaveTextContent('¡Hola! Soy KhipuBot.');
    expect(screen.getByRole('textbox', { name: /gastos o ingresos/i })).toBeEnabled();
  });

  it('C02-RES-20: un fallo al leer el chat guardado no bloquea un nuevo mensaje', async () => {
    const originalGetItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === 'khipubot_chat_messages') throw new DOMException('Almacenamiento no disponible', 'SecurityError');
      return originalGetItem.call(this, key);
    });
    renderChat();
    await sendText();
    expect(await screen.findByRole('heading', { name: 'Revisa tu transacción' })).toBeInTheDocument();
  });

  it('C02-RES-21: una cuota de almacenamiento agotada no impide confirmar en pantalla', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Sin espacio', 'QuotaExceededError'); });
    renderChat();
    const user = await sendText();
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver historial' })).toBeInTheDocument();
  });
});

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { api } from '../../lib/api';
import {
  contractError, deferred, foodCategory, renderWithTestRouter, salaryCategory, testWallet, transportCategory,
} from '../../test/cu01Cu02TestUtils';
import { installNativeMultipartMocks, installVoiceBrowserMocks, makeSavedVoiceResponse, makeVoiceDraft, makeVoicePreview } from '../../test/cu03TestUtils';
import { resetFrontendState } from '../../test/resetFrontendState';
import { LoginPage } from '../auth/LoginPage';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { SessionExpiryHandler } from '../auth/SessionExpiryHandler';
import { ChatPage } from './ChatPage';
import type { SavedTransactionResponse, TransactionPreview } from './transactionPreview.types';

vi.mock('../notifications/components/NotificationBell', () => ({ NotificationBell: () => null }));

let browser: ReturnType<typeof installVoiceBrowserMocks>;
const extract = vi.fn();
const save = vi.fn();

function installVoiceHandlers(preview = makeVoicePreview(), response = makeSavedVoiceResponse(makeVoiceDraft(preview))) {
  server.use(
    http.get('*/api/v1/categories', () => HttpResponse.json({
      data: [foodCategory, transportCategory, salaryCategory].map((category) => ({ ...category, type: category.type.toLowerCase() })),
    })),
    http.get('*/api/v1/wallets', () => HttpResponse.json({ data: [testWallet] })),
    http.post('*/api/v1/transactions/voice', async ({ request }) => {
      const body = await request.formData();
      extract({ audio: body.get('audio'), language: body.get('language'), authorization: request.headers.get('Authorization') });
      return HttpResponse.json(preview);
    }),
    http.post('*/api/v1/transactions/voice/confirm', async ({ request }) => {
      save({ body: await request.json(), key: request.headers.get('Idempotency-Key'), authorization: request.headers.get('Authorization') });
      return HttpResponse.json(response, { status: 201 });
    }),
  );
}

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

async function chooseAudio(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'Grabar nota de voz' }));
  const file = new File(['audio-cu03'], 'nota-cu03.webm', { type: 'audio/webm' });
  fireEvent.change(screen.getByLabelText('Seleccionar archivo de audio'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeEnabled());
  return { user, file };
}

async function sendAudio() {
  const { user, file } = await chooseAudio();
  await user.click(screen.getByRole('button', { name: 'Enviar audio' }));
  return { user, file };
}

async function acceptPreview(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Aceptar' }));
}

beforeEach(async () => {
  resetFrontendState();
  vi.clearAllMocks();
  localStorage.setItem('access_token', 'token-cu03');
  browser = installVoiceBrowserMocks();
  await installNativeMultipartMocks();
  installVoiceHandlers();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browser.restore();
});

describe('CU03 — flujo de voz del frontend con MSW', () => {
  it('C03-CHAT-01: sin sesión redirige a login y no permite grabar ni enviar', async () => {
    localStorage.removeItem('access_token');
    renderChat();
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grabar nota de voz' })).not.toBeInTheDocument();
    expect(browser.getUserMedia).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('C03-CHAT-02: abrir y cancelar el grabador no hace peticiones de voz', async () => {
    renderChat();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Grabar nota de voz' }));
    expect(screen.getByRole('dialog', { name: 'Registrar por voz' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(extract).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('C03-CHAT-03: muestra transcripción, monto, concepto y monedero sin guardar antes de aceptar', async () => {
    renderChat();
    const budgetsBefore = localStorage.getItem('mock_budgets_v2');
    const { file } = await sendAudio();
    expect(await screen.findByRole('heading', { name: 'Revisa la transacción por voz' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    expect(screen.getByText('Texto transcrito')).toBeInTheDocument();
    expect(screen.getByText(makeVoicePreview().transcript!)).toBeInTheDocument();
    expect(screen.getByText('S/ 15.00')).toBeInTheDocument();
    expect(screen.getByText('Almuerzo')).toBeInTheDocument();
    expect(screen.getByText(testWallet.name)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(extract).toHaveBeenCalledExactlyOnceWith({
      audio: expect.objectContaining({ name: file.name, size: file.size, type: file.type }),
      language: 'es-PE', authorization: 'Bearer token-cu03',
    });
    expect(save).not.toHaveBeenCalled();
    expect(localStorage.getItem('mock_budgets_v2')).toBe(budgetsBefore);
    const stored = localStorage.getItem('khipubot_chat_messages')!;
    expect(stored).toContain(makeVoicePreview().transcript);
    expect(stored).not.toContain(file.name);
    expect(stored).not.toContain('audio-cu03');
    expect(stored).not.toContain('blob:');
  });

  it('C03-CHAT-04: el audio grabado pasa por el servicio real del cliente hasta la vista previa', async () => {
    renderChat();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Grabar nota de voz' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Grabar nota de voz' }));
    await waitFor(() => expect(browser.recorders).toHaveLength(1));
    act(() => browser.recorders[0]!.emitData());
    await user.click(screen.getByRole('button', { name: 'Detener grabación' }));
    await user.click(screen.getByRole('button', { name: 'Enviar audio' }));
    expect(await screen.findByRole('heading', { name: 'Revisa la transacción por voz' })).toBeInTheDocument();
    expect(extract.mock.calls[0]?.[0].audio).toMatchObject({ name: 'nota-de-voz.webm', type: 'audio/webm;codecs=opus' });
    expect(browser.stopTrack).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('C03-CHAT-05: acepta con preview_id y datos completos; luego solo ofrece historial', async () => {
    renderChat();
    const { user } = await sendAudio();
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      body: { preview_id: 'preview-cu03-1', ...makeVoiceDraft() }, authorization: 'Bearer token-cu03',
      key: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i),
    });
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Ver historial' }));
    expect(await screen.findByRole('heading', { name: 'Historial de prueba' })).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('C03-CHAT-06: editar monto, concepto y categoría es local y confirma los datos corregidos', async () => {
    const edited = { ...makeVoiceDraft(), amount: '30.50', concept: 'Taxi a casa', category_id: transportCategory.id };
    const response = makeSavedVoiceResponse(edited);
    response.transaction.category = transportCategory;
    installVoiceHandlers(makeVoicePreview(), response);
    renderChat();
    const { user } = await sendAudio();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: '30.5' } });
    fireEvent.change(screen.getByLabelText(/^Concepto/i), { target: { value: '  Taxi a casa  ' } });
    await user.click(screen.getByRole('button', { name: 'Transporte' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText('S/ 30.50')).toBeInTheDocument();
    expect(screen.getByText('Taxi a casa')).toBeInTheDocument();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(screen.getByText('S/ 30.50')).toBeInTheDocument();
    expect(screen.getByText('Taxi a casa')).toBeInTheDocument();
    expect(save.mock.calls[0]?.[0].body).toEqual({
      preview_id: 'preview-cu03-1', ...edited,
    });
  });

  it('C03-CHAT-07: conserva tipo ingreso y moneda USD recibidos en la extracción', async () => {
    const preview = makeVoicePreview({ type: 'INCOME', currency: 'USD', concept: 'Sueldo', category: salaryCategory });
    installVoiceHandlers(preview);
    server.use(http.get('*/api/v1/wallets', () => HttpResponse.json({ data: [{ ...testWallet, currency: 'USD' }] })));
    renderChat();
    const { user } = await sendAudio();
    expect(await screen.findByText('$ 15.00')).toBeInTheDocument();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(save.mock.calls[0]?.[0].body).toMatchObject({ type: 'INCOME', currency: 'USD', category_id: salaryCategory.id });
  });

  it('C03-CHAT-08: mientras extrae bloquea envíos y no duplica el audio con doble clic', async () => {
    const pending = deferred();
    server.use(http.post('*/api/v1/transactions/voice', async () => {
      extract();
      await pending.promise;
      return HttpResponse.json(makeVoicePreview());
    }));
    renderChat();
    const { user } = await chooseAudio();
    try {
      await user.dblClick(screen.getByRole('button', { name: 'Enviar audio' }));
      await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
      expect(screen.getByRole('textbox', { name: /gastos o ingresos/i })).toBeDisabled();
      expect(save).not.toHaveBeenCalled();
    } finally {
      pending.resolve();
    }
    await screen.findByRole('heading', { name: 'Revisa la transacción por voz' });
    expect(screen.getByRole('textbox', { name: /gastos o ingresos/i })).toBeEnabled();
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('C03-CHAT-09: mientras guarda bloquea aceptar/editar y no duplica la confirmación', async () => {
    const pending = deferred();
    server.use(http.post('*/api/v1/transactions/voice/confirm', async () => {
      save();
      await pending.promise;
      return HttpResponse.json(makeSavedVoiceResponse(), { status: 201 });
    }));
    renderChat();
    const { user } = await sendAudio();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    try {
      await user.dblClick(screen.getByRole('button', { name: 'Aceptar' }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Editar' })).toBeDisabled();
    } finally {
      pending.resolve();
    }
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each([
    [422, 'AUDIO_UNINTELLIGIBLE', 'No pude entender el audio. ¿Puedes repetirlo o escribirlo?'],
    [422, 'AMOUNT_NOT_DETECTED', 'No pude identificar el monto. ¿Cuánto fue el gasto/ingreso?'],
    [503, 'STT_UNAVAILABLE', 'El servicio de voz no está disponible. Intenta más tarde.'],
    [503, 'NLP_UNAVAILABLE', 'El servicio de transacción por voz no está disponible. Por favor intente más tarde'],
  ])('C03-CHAT-10: muestra %i/%s en el grabador y permite reenviar el mismo audio', async (status, code, message) => {
    server.use(http.post('*/api/v1/transactions/voice', async ({ request }) => {
      const body = await request.formData();
      extract({ name: (body.get('audio') as File).name });
      return extract.mock.calls.length === 1 ? contractError(status, code, message) : HttpResponse.json(makeVoicePreview());
    }));
    renderChat();
    const { user, file } = await sendAudio();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('dialog', { name: 'Registrar por voz' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Revisa la transacción por voz' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Enviar audio' }));
    await screen.findByRole('heading', { name: 'Revisa la transacción por voz' });
    expect(extract.mock.calls).toEqual([[{ name: file.name }], [{ name: file.name }]]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'red', response: () => HttpResponse.error() },
    { name: 'respuesta no JSON', response: () => HttpResponse.text('No disponible', { status: 503 }) },
  ])('C03-CHAT-11: una falla de $name permite cancelar y volver al chat sin registrar', async ({ response }) => {
    server.use(http.post('*/api/v1/transactions/voice', response));
    renderChat();
    const { user } = await sendAudio();
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /gastos o ingresos/i })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Transacción registrada' })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    [422, 'CURRENCY_MISMATCH', 'La moneda no coincide con el monedero.'],
    [422, 'INVALID_CATEGORY', 'Selecciona una categoría válida.'],
    [409, 'NO_ACTIVE_WALLET', 'Selecciona un monedero disponible.'],
  ])('C03-CHAT-12: rechazar confirmación por %i/%s conserva el borrador y permite reintentar', async (status, code, message) => {
    server.use(http.post('*/api/v1/transactions/voice/confirm', async ({ request }) => {
      save(await request.json());
      return save.mock.calls.length === 1 ? contractError(status, code, message) : HttpResponse.json(makeSavedVoiceResponse(), { status: 201 });
    }));
    renderChat();
    const { user } = await sendAudio();
    await acceptPreview(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText(makeVoicePreview().transcript!)).toBeInTheDocument();
    expect(screen.getByText('S/ 15.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeEnabled();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(save.mock.calls).toEqual([
      [{ preview_id: 'preview-cu03-1', ...makeVoiceDraft() }],
      [{ preview_id: 'preview-cu03-1', ...makeVoiceDraft() }],
    ]);
  });

  it.each([
    { priority: 'normal' as const, title: 'Alerta de presupuesto' },
    { priority: 'high' as const, title: '¡Presupuesto excedido!' },
  ])('C03-CHAT-13: presenta alerta $priority recibida del mock después de confirmar', async ({ priority, title }) => {
    const response = makeSavedVoiceResponse();
    response.alerts = [{ message: `Aviso de presupuesto ${priority}.`, priority }];
    installVoiceHandlers(makeVoicePreview(), response);
    renderChat();
    const { user } = await sendAudio();
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(response.alerts[0]!.message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver presupuesto' })).toHaveAttribute('href', '/presupuestos');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('C03-CHAT-14: entre alertas normales presenta solo la de mayor umbral recibido', async () => {
    const response = makeSavedVoiceResponse();
    response.alerts = [
      { message: 'Aviso del 80%.', priority: 'normal', threshold_percentage: 80 },
      { message: 'Aviso del 90%.', priority: 'normal', threshold_percentage: 90 },
    ];
    installVoiceHandlers(makeVoicePreview(), response);
    renderChat();
    const { user } = await sendAudio();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Alerta de presupuesto' });
    expect(screen.getByText('Aviso del 90%.')).toBeInTheDocument();
    expect(screen.queryByText('Aviso del 80%.')).not.toBeInTheDocument();
  });

  it('C03-DEF-04: una alerta de prioridad alta prevalece sobre otra normal con umbral', async () => {
    const response: SavedTransactionResponse = {
      ...makeSavedVoiceResponse(),
      alerts: [{ message: 'Aviso normal.', priority: 'normal', threshold_percentage: 80 }],
      budget_alert: { message: 'Aviso prioritario.', priority: 'high', threshold_percentage: 100 },
    };
    installVoiceHandlers(makeVoicePreview(), response);
    renderChat();
    const { user } = await sendAudio();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(screen.getByRole('heading', { name: /Alerta de presupuesto|¡Presupuesto excedido!/ })).toHaveTextContent('¡Presupuesto excedido!');
    expect(screen.getByText('Aviso prioritario.')).toBeInTheDocument();
    expect(screen.queryByText('Aviso normal.')).not.toBeInTheDocument();
  });

  it('C03-CHAT-15: sin alertas confirma e invalida consultas financieras sin alterar otras cachés', async () => {
    const { queryClient } = renderChat();
    const keys = ['budgets', 'notifications', 'transactions', 'wallets', 'dashboard'];
    for (const key of [...keys, 'preferencias']) queryClient.setQueryData([key], { previo: true });
    const { user } = await sendAudio();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(screen.queryByRole('heading', { name: 'Alerta de presupuesto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '¡Presupuesto excedido!' })).not.toBeInTheDocument();
    for (const key of keys) expect(queryClient.getQueryState([key])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['preferencias'])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(['preferencias'])).toEqual({ previo: true });
  });

  it.each(['extraer', 'guardar'])('C03-CHAT-16: sesión expirada al %s revoca token, limpia caché y redirige', async (step) => {
    server.use(http.post(step === 'extraer' ? '*/api/v1/transactions/voice' : '*/api/v1/transactions/voice/confirm', () => contractError(401, 'SESSION_EXPIRED', 'Tu sesión expiró.')));
    const { queryClient } = renderChat();
    queryClient.setQueryData(['datos-privados'], { saldo: 'privado' });
    const { user } = await sendAudio();
    if (step === 'guardar') await acceptPreview(user);
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Transacción registrada' })).not.toBeInTheDocument();
  });

  it('C03-CHAT-17: restaura la transcripción sin audio ni peticiones automáticas y permite confirmarla', async () => {
    const view = renderChat();
    const { user } = await sendAudio();
    await screen.findByRole('heading', { name: 'Revisa la transacción por voz' });
    view.unmount();
    renderChat();
    expect(screen.getByText(makeVoicePreview().transcript!)).toBeInTheDocument();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('C03-MOCK-01: los mocks existentes extraen sin mutar el monedero y solo descuentan al confirmar', async () => {
    // Usa los handlers originales de la aplicación, no los contratos locales de esta suite.
    server.resetHandlers();
    const getWallet = () => api<{ current_balance: string; transaction_count: number }>(`/wallets/${testWallet.id}`);
    const before = await getWallet();
    renderChat();
    const { user } = await sendAudio();
    await screen.findByRole('heading', { name: 'Revisa la transacción por voz' });
    expect(screen.getByText('Gasté quince soles en el menú')).toBeInTheDocument();
    expect(await getWallet()).toMatchObject(before);
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    const after = await getWallet();
    expect(Number(after.current_balance)).toBe(Number(before.current_balance) - 15);
    expect(after.transaction_count).toBe(before.transaction_count + 1);
  });

  // Regresiones funcionales: se mantienen como pruebas normales para no ocultar defectos.
  it('C03-DEF-01: reintentar el mismo guardado tras fallo de red conserva la clave de idempotencia', async () => {
    const requests: Array<{ body: unknown; key: string | null }> = [];
    server.use(http.post('*/api/v1/transactions/voice/confirm', async ({ request }) => {
      requests.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
      return requests.length === 1 ? HttpResponse.error() : HttpResponse.json(makeSavedVoiceResponse(), { status: 201 });
    }));
    renderChat();
    const { user } = await sendAudio();
    await acceptPreview(user);
    await screen.findByRole('alert');
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Transacción registrada' });
    expect(requests).toHaveLength(2);
    expect(requests[0]?.key).toEqual(expect.any(String));
    expect(requests[1]).toEqual(requests[0]);
  });

  it('C03-DEF-02: no vuelve a persistir la transcripción privada tras expirar la sesión al guardar', async () => {
    server.use(http.post('*/api/v1/transactions/voice/confirm', () => contractError(401, 'SESSION_EXPIRED', 'Tu sesión expiró.')));
    renderChat();
    const { user } = await sendAudio();
    await acceptPreview(user);
    await screen.findByRole('heading', { name: 'Inicia sesión' });
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('khipubot_chat_messages')).toBeNull();
  });

  it('C03-DEF-03: una extracción sin monto no permite aceptar antes de corregirlo', async () => {
    const preview: TransactionPreview = makeVoicePreview({ amount: null });
    installVoiceHandlers(preview);
    renderChat();
    await sendAudio();
    await screen.findByRole('heading', { name: 'Revisa la transacción por voz' });
    // Esperar el monedero evita confundir el bloqueo inicial de carga con validación de monto.
    await screen.findByText(testWallet.name);
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});

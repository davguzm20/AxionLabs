import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { contractError, foodCategory, makeTextPreview, renderWithTestRouter, salaryCategory, testWallet, transportCategory } from '../../test/cu01Cu02TestUtils';
import { installNativeMultipartMocks, makeSavedVoiceResponse, makeVoiceDraft } from '../../test/cu03TestUtils';
import { resetFrontendState } from '../../test/resetFrontendState';
import { LoginPage } from '../auth/LoginPage';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { SessionExpiryHandler } from '../auth/SessionExpiryHandler';
import { ChatPage } from './ChatPage';
import type { SavedTransactionResponse, TransactionPreview } from './transactionPreview.types';

vi.mock('../notifications/components/NotificationBell', () => ({ NotificationBell: () => null }));

const OCR_TEXT = 'SUPERMERCADO XYZ\nRUC 20123456789\nTOTAL S/ 45.90';
const imageSettings = { width: 1280, height: 720, error: false };
const uploaded = vi.fn();
const confirmed = vi.fn();
let originalCreateObjectURL: PropertyDescriptor | undefined;
let originalRevokeObjectURL: PropertyDescriptor | undefined;

class ReceiptImageMock {
  naturalWidth = imageSettings.width;
  naturalHeight = imageSettings.height;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => imageSettings.error ? this.onerror?.() : this.onload?.());
  }
}

function makeReceiptPreview(amount: string | null = '45.90'): TransactionPreview {
  return makeTextPreview({
    amount,
    concept: 'Supermercado XYZ',
    merchant: 'Supermercado XYZ',
    ruc: '20123456789',
    category: { ...foodCategory },
  }, { preview_id: 'preview-cu04-1', ocr_text: OCR_TEXT });
}

function installReceiptHandlers(
  preview = makeReceiptPreview(),
  response: SavedTransactionResponse = makeSavedVoiceResponse(makeVoiceDraft(preview)),
) {
  server.use(
    http.get('*/api/v1/categories', () => HttpResponse.json({
      data: [foodCategory, transportCategory, salaryCategory].map((category) => ({ ...category, type: category.type.toLowerCase() })),
    })),
    http.get('*/api/v1/wallets', () => HttpResponse.json({ data: [testWallet] })),
    http.post('*/api/v1/transactions/receipt', async ({ request }) => {
      const body = await request.formData();
      uploaded({ image: body.get('image'), keys: [...body.keys()], authorization: request.headers.get('Authorization') });
      return HttpResponse.json(preview);
    }),
    http.post('*/api/v1/transactions/receipt/confirm', async ({ request }) => {
      confirmed({ body: await request.json(), key: request.headers.get('Idempotency-Key'), authorization: request.headers.get('Authorization') });
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

function selectImage(file: File) {
  fireEvent.change(screen.getByLabelText('Seleccionar foto de un comprobante'), { target: { files: [file] } });
}

function getOcrText() {
  return screen.getByText((_content, element) => element?.tagName.toLowerCase() === 'pre' && element.textContent === OCR_TEXT);
}

function makeImage(name = 'comprobante.jpg', type = 'image/jpeg', content: BlobPart = 'jpeg-receipt') {
  return new File([content], name, { type });
}

beforeEach(async () => {
  resetFrontendState();
  vi.clearAllMocks();
  imageSettings.width = 1280;
  imageSettings.height = 720;
  imageSettings.error = false;
  localStorage.setItem('access_token', 'token-cu04');
  vi.stubGlobal('Image', ReceiptImageMock);
  originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:receipt-cu04') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  await installNativeMultipartMocks();
  installReceiptHandlers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('CU04 — registro de transacción por foto de comprobante', () => {
  it('CU04-01: protege el flujo de foto si no hay sesión activa', async () => {
    localStorage.removeItem('access_token');
    renderChat();
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjuntar imagen' })).not.toBeInTheDocument();
    expect(uploaded).not.toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it.each([
    ['JPG', 'comprobante.jpg', 'image/jpeg'],
    ['PNG', 'comprobante.png', 'image/png'],
  ])('CU04-02: procesa un comprobante %s, presenta OCR editable y espera confirmación', async (_format, name, type) => {
    renderChat();
    selectImage(makeImage(name, type));
    expect(await screen.findByRole('heading', { name: 'Revisa los datos del comprobante' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    expect(getOcrText()).toBeInTheDocument();
    expect(screen.getByText('S/ 45.90')).toBeInTheDocument();
    expect(screen.getByText('Supermercado XYZ')).toBeInTheDocument();
    expect(uploaded).toHaveBeenCalledExactlyOnceWith({
      image: expect.objectContaining({ name, type, size: expect.any(Number) }),
      keys: ['image'],
      authorization: 'Bearer token-cu04',
    });
    expect(confirmed).not.toHaveBeenCalled();
    const persisted = localStorage.getItem('khipubot_chat_messages') ?? '';
    expect(JSON.parse(persisted)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'preview', preview: expect.objectContaining({ ocr_text: OCR_TEXT }) }),
    ]));
    expect(persisted).not.toContain(name);
    expect(persisted).not.toContain('jpeg-receipt');
    expect(persisted).not.toContain('blob:receipt-cu04');
  });

  it.each([
    ['extensión no admitida', makeImage('comprobante.gif', 'image/gif')],
    ['extensión no admitida aunque declare MIME JPG', makeImage('comprobante.txt', 'image/jpeg')],
  ])('CU04-03: rechaza una imagen con %s antes de llamar al OCR', async (_reason, file) => {
    renderChat();
    selectImage(file);
    expect(await screen.findByText('Solo aceptamos imágenes JPG o PNG.')).toBeInTheDocument();
    expect(uploaded).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Revisa los datos del comprobante' })).not.toBeInTheDocument();
  });

  it('CU04-04: rechaza una foto que no alcanza la resolución mínima requerida', async () => {
    imageSettings.width = 500;
    renderChat();
    selectImage(makeImage());
    expect(await screen.findByText('La imagen debe medir al menos 640 × 480 píxeles.')).toBeInTheDocument();
    expect(uploaded).not.toHaveBeenCalled();
  });

  it('CU04-05: rechaza imágenes mayores a 8 MB antes de enviarlas', async () => {
    renderChat();
    selectImage(makeImage('comprobante.jpg', 'image/jpeg', new Uint8Array(8 * 1024 * 1024 + 1)));
    expect(await screen.findByText('La imagen supera los 8 MB.')).toBeInTheDocument();
    expect(uploaded).not.toHaveBeenCalled();
  });

  it('CU04-06: permite completar el monto que el OCR no pudo identificar y confirma los datos corregidos', async () => {
    installReceiptHandlers(makeReceiptPreview(null));
    renderChat();
    selectImage(makeImage());
    expect(await screen.findByRole('heading', { name: 'Revisa los datos del comprobante' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(testWallet.name)).toBeInTheDocument());
    expect(getOcrText()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
    expect(confirmed).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: '52.40' } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(confirmed).toHaveBeenCalledExactlyOnceWith({
      body: expect.objectContaining({
        preview_id: 'preview-cu04-1', amount: '52.40', concept: 'Supermercado XYZ',
        category_id: foodCategory.id, wallet_id: testWallet.id, ocr_text: OCR_TEXT,
      }),
      key: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i),
      authorization: 'Bearer token-cu04',
    });
  });

  it('CU04-07: presenta el rechazo de baja calidad y permite volver a seleccionar una foto', async () => {
    const rejectImage = vi.fn(() => contractError(422, 'IMAGE_UNREADABLE', 'La imagen no es suficientemente clara. Por favor toma otra foto con mejor iluminación.'));
    server.use(http.post('*/api/v1/transactions/receipt', rejectImage));
    renderChat();
    selectImage(makeImage());
    expect(await screen.findByText('La imagen no es suficientemente clara. Por favor toma otra foto con mejor iluminación.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Revisa los datos del comprobante' })).not.toBeInTheDocument();
    expect(confirmed).not.toHaveBeenCalled();
    selectImage(makeImage('otra-foto.jpg'));
    await waitFor(() => expect(rejectImage).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('La imagen no es suficientemente clara. Por favor toma otra foto con mejor iluminación.')).toHaveLength(2);
  });

  it('CU04-08: informa que OCR no está disponible y deja accesible el ingreso manual', async () => {
    server.use(http.post('*/api/v1/transactions/receipt', () => contractError(503, 'OCR_UNAVAILABLE', 'El servicio de lectura de imágenes no está disponible. Por favor ingrese los datos manualmente.')));
    renderChat();
    selectImage(makeImage('comprobante-falla.jpg'));
    expect(await screen.findByText('El servicio de lectura de imágenes no está disponible. Por favor ingrese los datos manualmente.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '¿Qué gastos o ingresos tuviste hoy?' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Revisa los datos del comprobante' })).not.toBeInTheDocument();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('CU04-09: confirma una transacción solo después de aceptar la vista previa OCR', async () => {
    renderChat();
    selectImage(makeImage());
    await screen.findByRole('heading', { name: 'Revisa los datos del comprobante' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aceptar' })).toBeEnabled());
    expect(confirmed).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByRole('heading', { name: 'Transacción registrada' })).toBeInTheDocument();
    expect(confirmed).toHaveBeenCalledExactlyOnceWith({
      body: expect.objectContaining({ preview_id: 'preview-cu04-1', amount: '45.90', ocr_text: OCR_TEXT }),
      key: expect.any(String),
      authorization: 'Bearer token-cu04',
    });
  });
});

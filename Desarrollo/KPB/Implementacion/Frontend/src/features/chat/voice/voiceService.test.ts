import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { contractError } from '../../../test/cu01Cu02TestUtils';
import { installNativeMultipartMocks, makeSavedVoiceResponse, makeVoiceDraft, makeVoicePreview } from '../../../test/cu03TestUtils';
import { resetFrontendState } from '../../../test/resetFrontendState';
import { confirmVoicePreview, createVoicePreview } from './voiceService';

beforeEach(async () => {
  resetFrontendState();
  localStorage.setItem('access_token', 'token-cu03');
  await installNativeMultipartMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('CU03 — transporte HTTP con MSW', () => {
  it('C03-API-01: envía audio y es-PE como multipart con token, sin guardar la transacción', async () => {
    const received = vi.fn();
    const save = vi.fn();
    const preview = makeVoicePreview();
    const file = new File(['audio-cu03'], 'nota.webm', { type: 'audio/webm' });
    server.use(
      http.post('*/api/v1/transactions/voice', async ({ request }) => {
        const body = await request.formData();
        received({
          audio: body.get('audio'), language: body.get('language'), fields: [...body.keys()],
          authorization: request.headers.get('Authorization'), contentType: request.headers.get('Content-Type'),
        });
        return HttpResponse.json(preview);
      }),
      http.post('*/api/v1/transactions/voice/confirm', () => { save(); return HttpResponse.json(makeSavedVoiceResponse()); }),
    );
    expect(await createVoicePreview(file)).toEqual(preview);
    expect(received).toHaveBeenCalledExactlyOnceWith({
      audio: expect.objectContaining({ name: 'nota.webm', type: 'audio/webm', size: file.size }),
      language: 'es-PE', fields: ['audio', 'language'], authorization: 'Bearer token-cu03',
      contentType: expect.stringMatching(/^multipart\/form-data; boundary=/),
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('C03-API-02: confirma el preview_id y todos los datos con JSON y clave de idempotencia', async () => {
    const received = vi.fn();
    const draft = makeVoiceDraft();
    const response = makeSavedVoiceResponse(draft);
    server.use(http.post('*/api/v1/transactions/voice/confirm', async ({ request }) => {
      received({
        body: await request.json(), authorization: request.headers.get('Authorization'),
        contentType: request.headers.get('Content-Type'), key: request.headers.get('Idempotency-Key'),
      });
      return HttpResponse.json(response, { status: 201 });
    }));
    expect(await confirmVoicePreview('preview-cu03-1', draft)).toEqual(response);
    expect(received).toHaveBeenCalledExactlyOnceWith({
      body: { preview_id: 'preview-cu03-1', ...draft }, authorization: 'Bearer token-cu03',
      contentType: 'application/json', key: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i),
    });
  });

  it.each([
    [422, 'AUDIO_UNINTELLIGIBLE', 'No pude entender el audio. ¿Puedes repetirlo o escribirlo?'],
    [422, 'AMOUNT_NOT_DETECTED', 'No pude identificar el monto. ¿Cuánto fue el gasto/ingreso?'],
    [503, 'STT_UNAVAILABLE', 'El servicio de voz no está disponible. Intenta más tarde.'],
    [503, 'NLP_UNAVAILABLE', 'El servicio de transacción por voz no está disponible. Por favor intente más tarde'],
  ])('C03-API-03: propaga %i/%s sin convertirlo en vista previa', async (status, code, message) => {
    server.use(http.post('*/api/v1/transactions/voice', () => contractError(status, code, message)));
    await expect(createVoicePreview(new File(['audio'], 'nota.wav', { type: 'audio/wav' }))).rejects.toMatchObject({ status, code, message });
  });

  it('C03-API-04: conserva el código y mensaje de un rechazo de confirmación', async () => {
    server.use(http.post('*/api/v1/transactions/voice/confirm', () => contractError(422, 'CURRENCY_MISMATCH', 'La moneda no coincide con el monedero.')));
    await expect(confirmVoicePreview('preview-cu03-1', makeVoiceDraft())).rejects.toMatchObject({
      status: 422, code: 'CURRENCY_MISMATCH', message: 'La moneda no coincide con el monedero.',
    });
  });

  it.each(['extraer', 'confirmar'])('C03-API-05: una falla de red al %s rechaza la promesa', async (step) => {
    server.use(http.post(step === 'extraer' ? '*/api/v1/transactions/voice' : '*/api/v1/transactions/voice/confirm', () => HttpResponse.error()));
    const request = step === 'extraer'
      ? createVoicePreview(new File(['audio'], 'nota.webm', { type: 'audio/webm' }))
      : confirmVoicePreview('preview-cu03-1', makeVoiceDraft());
    await expect(request).rejects.toBeInstanceOf(Error);
  });

  it.each(['extraer', 'confirmar'])('C03-API-06: SESSION_EXPIRED al %s emite el evento de expiración', async (step) => {
    const expired = vi.fn();
    window.addEventListener('khipubot:session-expired', expired);
    server.use(http.post(step === 'extraer' ? '*/api/v1/transactions/voice' : '*/api/v1/transactions/voice/confirm', () => contractError(401, 'SESSION_EXPIRED', 'Tu sesión expiró.')));
    try {
      const request = step === 'extraer'
        ? createVoicePreview(new File(['audio'], 'nota.webm', { type: 'audio/webm' }))
        : confirmVoicePreview('preview-cu03-1', makeVoiceDraft());
      await expect(request).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
      expect(expired).toHaveBeenCalledTimes(1);
      expect((expired.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ message: 'Tu sesión expiró.' });
    } finally {
      window.removeEventListener('khipubot:session-expired', expired);
    }
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../test/cu01Cu02TestUtils';
import { installVoiceBrowserMocks } from '../../../test/cu03TestUtils';
import { VoiceRecorder } from './VoiceRecorder';

let browser: ReturnType<typeof installVoiceBrowserMocks>;

function renderRecorder(onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  const view = render(<VoiceRecorder onClose={onClose} onSubmit={onSubmit} />);
  return { ...view, onClose, onSubmit };
}

async function selectFile(file = new File(['audio'], 'nota.webm', { type: 'audio/webm' })) {
  // Permite probar también formatos rechazados por la aplicación, sin el filtro de user.upload.
  fireEvent.change(screen.getByLabelText('Seleccionar archivo de audio'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeEnabled());
  return file;
}

async function startRecording() {
  fireEvent.click(screen.getByRole('button', { name: 'Grabar nota de voz' }));
  await act(async () => { await Promise.resolve(); });
  expect(browser.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
  const recorder = browser.recorders[0]!;
  expect(recorder.start).toHaveBeenCalledTimes(1);
  return recorder;
}

beforeEach(() => { browser = installVoiceBrowserMocks(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  browser.restore();
});

describe('CU03 — grabación y selección de audio', () => {
  it('C03-REC-01: abre sin pedir micrófono y no permite enviar sin audio', () => {
    const { onSubmit } = renderRecorder();
    expect(screen.getByRole('dialog', { name: 'Registrar por voz' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('00:00 / 01:00');
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar audio' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(browser.getUserMedia).not.toHaveBeenCalled();
  });

  it.each(['getUserMedia', 'MediaRecorder'])('C03-REC-02: sin %s ofrece seleccionar un archivo', async (missing) => {
    if (missing === 'getUserMedia') Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    else vi.stubGlobal('MediaRecorder', undefined);
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Grabar nota de voz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este navegador no permite grabar audio. Puedes seleccionar un archivo.');
    expect(browser.getUserMedia).not.toHaveBeenCalled();
    await selectFile();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeEnabled();
  });

  it('C03-REC-03: permiso denegado muestra una alternativa sin habilitar envío', async () => {
    browser.getUserMedia.mockRejectedValue(new DOMException('Permiso denegado', 'NotAllowedError'));
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Grabar nota de voz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo acceder al micrófono. Revisa el permiso o selecciona un archivo.');
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
    expect(browser.recorders).toHaveLength(0);
  });

  it('C03-REC-04: graba, reúne los fragmentos, detiene y envía el archivo generado', async () => {
    const { onSubmit, onClose } = renderRecorder();
    const recorder = await startRecording();
    expect(recorder.mimeType).toBe('audio/webm;codecs=opus');
    expect(screen.getByRole('button', { name: 'Elegir archivo de audio' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
    act(() => {
      recorder.emitData(new Blob([]));
      recorder.emitData(new Blob(['primero']));
      recorder.emitData(new Blob(['segundo']));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Detener grabación' }));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(browser.stopTrack).toHaveBeenCalled();
    expect(screen.getByText('Audio listo: nota-de-voz.webm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar audio' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: 'nota-de-voz.webm', type: 'audio/webm;codecs=opus', size: 14,
    }));
  });

  it.each([
    ['audio/ogg;codecs=opus', 'ogg'], ['audio/mp4', 'mp4'],
  ])('C03-REC-05: elige el formato compatible %s y la extensión %s', async (mime, extension) => {
    browser.RecorderStub.isTypeSupported.mockImplementation((type) => type === mime);
    renderRecorder();
    const recorder = await startRecording();
    act(() => recorder.emitData());
    fireEvent.click(screen.getByRole('button', { name: 'Detener grabación' }));
    expect(recorder.mimeType).toBe(mime);
    expect(screen.getByText(`Audio listo: nota-de-voz.${extension}`)).toBeInTheDocument();
  });

  it('C03-REC-06: deja al navegador elegir formato si ninguno de los propuestos es compatible', async () => {
    browser.RecorderStub.isTypeSupported.mockReturnValue(false);
    renderRecorder();
    const recorder = await startRecording();
    act(() => recorder.emitData());
    fireEvent.click(screen.getByRole('button', { name: 'Detener grabación' }));
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeEnabled();
  });

  it('C03-REC-07: actualiza el contador y detiene automáticamente al llegar a 60 segundos', async () => {
    vi.useFakeTimers();
    renderRecorder();
    const recorder = await startRecording();
    act(() => recorder.emitData());
    act(() => vi.advanceTimersByTime(59_000));
    expect(screen.getByRole('status')).toHaveTextContent('00:59 / 01:00');
    expect(recorder.stop).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('status')).toHaveTextContent('01:00 / 01:00');
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(browser.stopTrack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeEnabled();
    act(() => vi.advanceTimersByTime(5000));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it.each(['Cancelar', 'Cerrar grabación'])('C03-REC-08: %s detiene el micrófono sin enviar', async (button) => {
    const { onSubmit, onClose } = renderRecorder();
    const recorder = await startRecording();
    act(() => recorder.emitData());
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(browser.stopTrack).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('C03-REC-09: desmontar detiene la grabación y limpia el temporizador', async () => {
    vi.useFakeTimers();
    const { unmount, onSubmit } = renderRecorder();
    const recorder = await startRecording();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(browser.stopTrack).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('C03-REC-10: un error del grabador libera el micrófono y permite volver a intentar', async () => {
    renderRecorder();
    const recorder = await startRecording();
    act(() => recorder.onerror?.());
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo grabar el audio. Inténtalo nuevamente.');
    expect(browser.stopTrack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Grabar nota de voz' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Grabar nota de voz' }));
    await waitFor(() => expect(browser.recorders).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('C03-REC-11: una grabación mayor de 5 MB se rechaza sin enviar', async () => {
    const { onSubmit } = renderRecorder();
    const recorder = await startRecording();
    act(() => recorder.emitData(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])));
    fireEvent.click(screen.getByRole('button', { name: 'Detener grabación' }));
    expect(screen.getByRole('alert')).toHaveTextContent('El audio supera los 5 MB. Graba un mensaje más corto.');
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
    expect(browser.stopTrack).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['webm', 'ogg', 'mp4', 'mpeg', 'wav'])('C03-REC-12: acepta un archivo audio/%s sin pedir micrófono', async (extension) => {
    renderRecorder();
    const file = new File(['audio'], `nota.${extension}`, { type: `audio/${extension}` });
    await selectFile(file);
    expect(screen.getByText(`Audio listo: ${file.name}`)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('00:12 / 01:00');
    expect(browser.getUserMedia).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Seleccionar archivo de audio')).toHaveValue('');
  });

  it.each([59, 60])('C03-REC-13: acepta el límite de duración de %i segundos y 5 MB exactos', async (duration) => {
    browser.media.duration = duration;
    renderRecorder();
    await selectFile(new File([new Uint8Array(5 * 1024 * 1024)], 'limite.wav', { type: 'audio/wav' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    { name: 'formato no admitido', type: 'text/plain', bytes: 1, duration: 12, corrupt: false, message: 'Usa un audio webm, ogg, mp4, mpeg o wav.' },
    { name: 'tamaño de 5 MB más un byte', type: 'audio/webm', bytes: 5 * 1024 * 1024 + 1, duration: 12, corrupt: false, message: 'El audio no puede superar los 5 MB.' },
    { name: 'duración mayor de 60 segundos', type: 'audio/webm', bytes: 1, duration: 60.01, corrupt: false, message: 'El audio no puede durar más de 60 segundos.' },
    { name: 'metadatos ilegibles', type: 'audio/webm', bytes: 1, duration: 12, corrupt: true, message: 'No se pudo leer el audio. Selecciona otro archivo.' },
  ])('C03-REC-14: rechaza $name y permite reemplazar el archivo', async ({ type, bytes, duration, corrupt, message }) => {
    const { onSubmit } = renderRecorder();
    browser.media.duration = duration;
    browser.media.metadataError = corrupt;
    fireEvent.change(screen.getByLabelText('Seleccionar archivo de audio'), {
      target: { files: [new File([new Uint8Array(bytes)], 'invalido', { type })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
    if (corrupt || duration > 60) expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    else expect(URL.createObjectURL).not.toHaveBeenCalled();
    browser.media.duration = 12;
    browser.media.metadataError = false;
    await selectFile();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('C03-REC-15: cancelar el selector de archivos no habilita envío', () => {
    renderRecorder();
    fireEvent.change(screen.getByLabelText('Seleccionar archivo de audio'), { target: { files: [] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
  });

  it('C03-REC-18: reemplazar un archivo válido por otro inválido descarta el anterior', async () => {
    const { onSubmit } = renderRecorder();
    await selectFile();
    fireEvent.change(screen.getByLabelText('Seleccionar archivo de audio'), {
      target: { files: [new File(['texto'], 'no-es-audio.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Usa un audio webm, ogg, mp4, mpeg o wav.');
    expect(screen.queryByText('Audio listo: nota.webm')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('C03-REC-16: durante el envío bloquea los controles y un doble clic no duplica la petición', async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    const { onClose } = renderRecorder(onSubmit);
    const file = await selectFile();
    try {
      await userEvent.setup().dblClick(screen.getByRole('button', { name: 'Enviar audio' }));
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(file);
      for (const name of ['Enviando…', 'Grabar nota de voz', 'Elegir archivo de audio', 'Cancelar', 'Cerrar grabación']) {
        expect(screen.getByRole('button', { name })).toBeDisabled();
      }
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      await act(async () => { pending.resolve(); await pending.promise; });
    }
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([new Error('Servicio de voz no disponible.'), 'fallo sin mensaje'])('C03-REC-17: conserva el archivo tras un rechazo %s y permite reenviarlo', async (error) => {
    const onSubmit = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const { onClose } = renderRecorder(onSubmit);
    const file = await selectFile();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar audio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(error instanceof Error ? error.message : 'No se pudo enviar el audio. Inténtalo nuevamente.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Enviar audio' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar audio' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls).toEqual([[file], [file]]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

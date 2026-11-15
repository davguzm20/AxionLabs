import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/server';

const url = 'http://localhost/api/v1/test/browser-globals';

function clearStorage() {
  localStorage.clear();
  sessionStorage.clear();
}

beforeEach(clearStorage);
afterEach(clearStorage);

describe('compatibilidad de jsdom con las APIs nativas de Node', () => {
  it('usa localStorage de jsdom desde window y globalThis', () => {
    expect(localStorage).toBeInstanceOf(Storage);
    expect(window.localStorage).toBe(globalThis.localStorage);

    localStorage.setItem('compatibility', 'ok');
    expect(window.localStorage.getItem('compatibility')).toBe('ok');

    window.localStorage.clear();
    expect(localStorage.getItem('compatibility')).toBeNull();
  });

  it('mantiene sessionStorage separado de localStorage', () => {
    expect(sessionStorage).toBeInstanceOf(Storage);
    expect(window.sessionStorage).toBe(globalThis.sessionStorage);

    localStorage.setItem('compatibility', 'local');
    sessionStorage.setItem('compatibility', 'session');
    expect(localStorage.getItem('compatibility')).toBe('local');
    expect(sessionStorage.getItem('compatibility')).toBe('session');

    sessionStorage.clear();
    expect(localStorage.getItem('compatibility')).toBe('local');
  });

  it('acepta AbortSignal en Request y propaga la cancelación', () => {
    const controller = new AbortController();
    const request = new Request(url, { signal: controller.signal });
    const reason = new Error('Petición cancelada');

    expect(controller.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal.aborted).toBe(false);
    controller.abort(reason);
    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBe(reason);
  });

  it('permite que MSW responda a fetch con una señal de cancelación', async () => {
    server.use(http.get(url, () => HttpResponse.json({ ok: true })));
    const controller = new AbortController();

    const response = await fetch(url, { signal: controller.signal });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(controller.signal.aborted).toBe(false);
  });

  it('cancela una petición mientras MSW la procesa', async () => {
    const controller = new AbortController();
    const handleRequest = vi.fn(() => {
      controller.abort();
      return HttpResponse.json({ ok: true });
    });
    server.use(http.get(url, handleRequest));

    await expect(fetch(url, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(handleRequest).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
  });
});

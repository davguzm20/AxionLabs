import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { server } from '../../mocks/server';
import { resetFrontendState } from '../../test/resetFrontendState';
import { contractError, renderWithTestRouter } from '../../test/cu01Cu02TestUtils';
import { LoginPage } from './LoginPage';
import { ProtectedRoute } from './ProtectedRoute';
import { SessionExpiryHandler } from './SessionExpiryHandler';

function renderSession(path = '/privado') {
  return renderWithTestRouter(
    <>
      <SessionExpiryHandler />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/publico" element={<h1>Página pública</h1>} />
        <Route element={<ProtectedRoute />}><Route path="/privado" element={<h1>Página privada</h1>} /></Route>
      </Routes>
    </>,
    { path },
  );
}

beforeEach(() => resetFrontendState());
afterEach(() => vi.restoreAllMocks());

describe('CU01 — sesión del frontend', () => {
  it('C01-SES-01: permite una ruta protegida con sesión sin llamar a login', () => {
    localStorage.setItem('access_token', 'token-vigente');
    const login = vi.fn();
    server.use(http.post('*/api/v1/auth/login', () => { login(); return HttpResponse.json({}); }));
    renderSession();
    expect(screen.getByRole('heading', { name: 'Página privada' })).toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/privado');
    expect(login).not.toHaveBeenCalled();
  });

  it('C01-SES-02: después del login regresa a la ruta protegida solicitada', async () => {
    const user = userEvent.setup();
    let received: unknown;
    server.use(http.post('*/api/v1/auth/login', async ({ request }) => {
      received = await request.json();
      return HttpResponse.json({ access_token: 'token-destino' });
    }));
    renderSession();
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: 'persona@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/i), { target: { value: 'Clave1234' } });
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(await screen.findByRole('heading', { name: 'Página privada' })).toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/privado');
    expect(received).toEqual({ email: 'persona@example.test', password: 'Clave1234', device: { platform: 'web' } });
  });

  it('C01-SES-03: una petición autenticada expirada limpia los datos privados y navega al login', async () => {
    localStorage.setItem('access_token', 'token-vencido');
    localStorage.setItem('khipubot_chat_messages', '[{"kind":"bubble","text":"privado"}]');
    const budgetsBefore = localStorage.getItem('mock_budgets_v2');
    const { queryClient } = renderSession();
    queryClient.setQueryData(['privado'], { secreto: 'no debe sobrevivir' });
    const requestHeaders = vi.fn();
    server.use(http.get('*/api/v1/recurso-privado', ({ request }) => {
      requestHeaders(request.headers.get('Authorization'));
      return contractError(401, 'SESSION_EXPIRED', 'Tu sesión expiró.');
    }));
    await act(async () => {
      await expect(api('/recurso-privado')).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    });
    expect(requestHeaders).toHaveBeenCalledExactlyOnceWith('Bearer token-vencido');
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Tu sesión expiró. Inicia sesión nuevamente.');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('khipubot_chat_messages')).toBeNull();
    expect(localStorage.getItem('mock_budgets_v2')).toBe(budgetsBefore);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('C01-SES-04: varios eventos de expiración solo limpian la sesión una vez', async () => {
    localStorage.setItem('access_token', 'token-vencido');
    const { queryClient } = renderSession();
    const clear = vi.spyOn(queryClient, 'clear');
    act(() => {
      window.dispatchEvent(new CustomEvent('khipubot:session-expired'));
      window.dispatchEvent(new CustomEvent('khipubot:session-expired'));
    });
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(screen.getAllByLabelText('ruta actual')).toHaveLength(1);
  });

  it('C01-SES-05: retira el listener al desmontar y no procesa eventos posteriores', () => {
    localStorage.setItem('access_token', 'token-vigente');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = renderSession();
    const clear = vi.spyOn(view.queryClient, 'clear');
    view.unmount();
    expect(remove).toHaveBeenCalledWith('khipubot:session-expired', expect.any(Function));
    window.dispatchEvent(new CustomEvent('khipubot:session-expired'));
    expect(clear).not.toHaveBeenCalled();
    expect(localStorage.getItem('access_token')).toBe('token-vigente');
  });

  it.each([
    { name: 'login', path: '/auth/login', token: true, code: 'SESSION_EXPIRED' },
    { name: 'logout', path: '/auth/logout', token: true, code: 'SESSION_EXPIRED' },
    { name: 'petición sin token', path: '/recurso-privado', token: false, code: 'SESSION_EXPIRED' },
    { name: 'otro error 401', path: '/recurso-privado', token: true, code: 'UNAUTHENTICATED' },
  ])('C01-SES-06: $name no dispara una redirección global de sesión expirada', async ({ path, token, code }) => {
    if (token) localStorage.setItem('access_token', 'token-prueba');
    renderSession('/publico');
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    server.use(http.post(`*/api/v1${path}`, () => contractError(401, code, 'Acceso rechazado.')));
    await act(async () => {
      await expect(api(path, { method: 'POST' })).rejects.toMatchObject({ status: 401, code });
    });
    expect(dispatch.mock.calls.filter(([event]) => event.type === 'khipubot:session-expired')).toHaveLength(0);
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/publico');
    expect(localStorage.getItem('access_token')).toBe(token ? 'token-prueba' : null);
  });

  it('C01-SES-07: respeta Authorization explícito y procesa un 204 sin leer JSON', async () => {
    localStorage.setItem('access_token', 'token-almacenado');
    const headers = vi.fn();
    server.use(http.post('*/api/v1/operacion-vacia', ({ request }) => {
      headers(request.headers.get('Authorization'));
      return new HttpResponse(null, { status: 204 });
    }));
    await expect(api('/operacion-vacia', { method: 'POST', headers: { Authorization: 'Bearer token-explícito' } })).resolves.toBeUndefined();
    expect(headers).toHaveBeenCalledExactlyOnceWith('Bearer token-explícito');
  });

  it('C01-SES-08: una respuesta no JSON se transforma en un error controlado', async () => {
    localStorage.setItem('access_token', 'token-vigente');
    renderSession();
    server.use(http.get('*/api/v1/recurso-privado', () => HttpResponse.text('Servicio no disponible', { status: 503 })));
    await expect(api('/recurso-privado')).rejects.toMatchObject({
      status: 503, message: 'No se pudo completar la solicitud. Inténtalo nuevamente.',
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Página privada' })).toBeInTheDocument());
    expect(localStorage.getItem('access_token')).toBe('token-vigente');
  });
});

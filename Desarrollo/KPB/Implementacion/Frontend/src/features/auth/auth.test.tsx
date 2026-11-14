import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { api } from '../../lib/api';
import { resetFrontendState } from '../../test/resetFrontendState';
import { deferred } from '../../test/cu01Cu02TestUtils';
import { SettingsPage } from '../settings/pages/SettingsPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { LoginPage } from './LoginPage';
import { ProtectedRoute } from './ProtectedRoute';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SessionExpiryHandler } from './SessionExpiryHandler';

vi.mock('../cu08/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('../notifications/services/notificationService', () => ({
  getUserPreferences: vi.fn(async () => ({ main_currency: 'PEN', email_notifications: true })),
  updateEmailNotificationPreference: vi.fn(async (enabled: boolean) => ({ main_currency: 'PEN', email_notifications: enabled })),
}));

const API = 'http://localhost/api/v1';

function CurrentPath() {
  const location = useLocation();
  return <output aria-label="ruta actual">{location.pathname}</output>;
}

function AuthRouter({ initialPath = '/login', state }: { initialPath?: string; state?: unknown }) {
  return (
    <MemoryRouter initialEntries={[{ pathname: initialPath, state }]}>
      <SessionExpiryHandler />
      <CurrentPath />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recuperar-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/inicio" element={<h1>Inicio</h1>} />
        <Route path="/historial" element={<ProtectedRoute />}><Route index element={<h1>Historial</h1>} /></Route>
        <Route path="/ajustes" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderAuth(path = '/login', state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}><AuthRouter initialPath={path} state={state} /></QueryClientProvider>);
  return { ...view, queryClient };
}

async function createRecoveryId(email = 'persona@example.test') {
  const response = await fetch(`${API}/auth/password/forgot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(202);
  return (await response.json() as { recovery_id: string }).recovery_id;
}

function contractError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json({ error: { code, message, details: [], trace_id: `req_${code.toLowerCase()}`, ...extra } }, { status });
}

beforeEach(() => resetFrontendState());

describe('CU01 — autenticación', () => {
  it('C01-01: inicia sesión con device.platform, guarda token y navega a /inicio', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(http.post('*/api/v1/auth/login', async ({ request }) => {
      body = await request.json() as Record<string, unknown>;
      return HttpResponse.json({ access_token: 'token-de-sesion', token_type: 'Bearer', inactivity_timeout_seconds: 1200, user: { id: 'user-test-1', email: 'persona@example.test' } });
    }));
    renderAuth();
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: 'persona@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Contrase/i), { target: { value: 'Clave1234' } });
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/inicio');
    expect(localStorage.getItem('access_token')).toBe('token-de-sesion');
    expect(body).toMatchObject({ device: { platform: 'web' } });
  });

  it('C01-02a: muestra el mismo 401 para correo existente e inexistente', async () => {
    const user = userEvent.setup();
    renderAuth();
    const messages: string[] = [];
    for (const email of ['demo@test.com', 'no-existe@example.test']) {
      await user.clear(screen.getByLabelText(/^Correo/i));
      fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: email } });
      fireEvent.change(screen.getByLabelText(/^Contrase/i), { target: { value: 'incorrecta' } });
      await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
      await waitFor(() => expect(screen.getByLabelText(/^Contrase/i)).toHaveValue(''));
      messages.push((await screen.findByRole('alert')).textContent ?? '');
    }
    expect(messages[0]).toBe(messages[1]);
    expect(messages[0]).toContain('Correo o contrase');
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login');
  });

  it('C01-02b: muestra el texto exacto de INVALID_CREDENTIALS definido por API-01', async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.type(screen.getByLabelText(/^Correo/i), 'no-existe@example.test');
    await user.type(screen.getByLabelText(/^Contrase/i), 'incorrecta');
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos. Inténtelo de nuevo');
  });

  it('C01-03: valida campos vacíos y formato de correo sin navegar ni llamar a la API', async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(http.post('*/api/v1/auth/login', () => { requests += 1; return HttpResponse.json({ access_token: 'no-debe-usarse' }); }));
    renderAuth();
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(screen.getByLabelText(/^Correo/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Contrase/i)).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText(/^Correo/i), 'correo-invalido');
    await user.type(screen.getByLabelText(/^Contrase/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(screen.getByLabelText(/^Correo/i)).toHaveAttribute('aria-invalid', 'true');
    expect(requests).toBe(0);
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login');
  });

  it('C01-04: presenta ACCOUNT_LOCKED 423 y permanece en login', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/auth/login', () => contractError(423, 'ACCOUNT_LOCKED', 'La cuenta está bloqueada.', { retry_after_seconds: 1800 })));
    renderAuth();
    await user.type(screen.getByLabelText(/^Correo/i), 'persona@example.test');
    await user.type(screen.getByLabelText(/^Contrase/i), 'incorrecta');
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu cuenta se bloque');
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login');
  });

  it('C01-05: responde igual exista o no el correo y avanza al paso 2', async () => {
    const getResponse = async (email: string) => fetch(`${API}/auth/password/forgot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const existing = await getResponse('demo@test.com');
    const existingBody = await existing.json() as { message: string };
    const absent = await getResponse('ausente@example.test');
    expect(absent.status).toBe(202);
    expect(await absent.json()).toMatchObject({ message: existingBody.message, code_expires_in_seconds: 60 });
    const user = userEvent.setup();
    renderAuth('/recuperar-password');
    await user.type(screen.getByLabelText(/^Correo/i), 'ausente@example.test');
    await user.click(screen.getByRole('button', { name: /Enviar c.digo/i }));
    expect(await screen.findByText('Paso 2 de 2')).toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
  });

  it('C01-06: muestra el rechazo RECOVERY_CODE_INVALID y no navega', async () => {
    const recoveryId = await createRecoveryId();
    server.use(http.post('*/api/v1/auth/password/verify-code', () => contractError(400, 'RECOVERY_CODE_INVALID', 'El código ingresado es incorrecto.')));
    const user = userEvent.setup();
    renderAuth('/reset-password', { recovery_id: recoveryId, email: 'persona@example.test' });
    await user.type(screen.getByLabelText(/^C.digo/i), '123456');
    await user.type(screen.getByLabelText(/^Nueva contrase/i), 'Clave1234');
    await user.type(screen.getByLabelText(/^Confirmar nueva/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Cambiar contrase/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Solicita uno nuevo');
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
  });

  it('C01-07: muestra RECOVERY_CODE_EXPIRED y no navega', async () => {
    const recoveryId = await createRecoveryId();
    server.use(http.post('*/api/v1/auth/password/verify-code', () => contractError(410, 'RECOVERY_CODE_EXPIRED', 'El código expiró. Debe solicitar uno nuevo.')));
    const user = userEvent.setup();
    renderAuth('/reset-password', { recovery_id: recoveryId, email: 'persona@example.test' });
    await user.type(screen.getByLabelText(/^C.digo/i), '123456');
    await user.type(screen.getByLabelText(/^Nueva contrase/i), 'Clave1234');
    await user.type(screen.getByLabelText(/^Confirmar nueva/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Cambiar contrase/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Solicita uno nuevo');
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
  });

  it('C01-08: permanece en el formulario si el reset rechaza PASSWORD_MISMATCH', async () => {
    const recoveryId = await createRecoveryId();
    server.use(
      http.post('*/api/v1/auth/password/verify-code', () => HttpResponse.json({ reset_token: 'reset-test-token', reset_token_expires_in_seconds: 300 })),
      http.post('*/api/v1/auth/password/reset', () => contractError(422, 'PASSWORD_MISMATCH', 'Las contraseñas no coinciden.')),
    );
    const user = userEvent.setup();
    renderAuth('/reset-password', { recovery_id: recoveryId, email: 'persona@example.test' });
    await user.type(screen.getByLabelText(/^C.digo/i), '123456');
    await user.type(screen.getByLabelText(/^Nueva contrase/i), 'Clave1234');
    await user.type(screen.getByLabelText(/^Confirmar nueva/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Cambiar contrase/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.');
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
  });

  it('C01-09: permanece en el formulario si el reset rechaza PASSWORD_POLICY_VIOLATION', async () => {
    const recoveryId = await createRecoveryId();
    server.use(
      http.post('*/api/v1/auth/password/verify-code', () => HttpResponse.json({ reset_token: 'reset-test-token', reset_token_expires_in_seconds: 300 })),
      http.post('*/api/v1/auth/password/reset', () => contractError(422, 'PASSWORD_POLICY_VIOLATION', 'La contraseña no cumple la política mínima definida.')),
    );
    const user = userEvent.setup();
    renderAuth('/reset-password', { recovery_id: recoveryId, email: 'persona@example.test' });
    await user.type(screen.getByLabelText(/^C.digo/i), '123456');
    await user.type(screen.getByLabelText(/^Nueva contrase/i), 'Clave1234');
    await user.type(screen.getByLabelText(/^Confirmar nueva/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Cambiar contrase/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña no cumple la política mínima definida.');
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
  });

  it('C01-10: acepta la respuesta 204 del reset y redirige a login', async () => {
    const recoveryId = await createRecoveryId();
    let resetStatus = 0;
    server.use(http.post('*/api/v1/auth/password/reset', () => { resetStatus = 204; return new HttpResponse(null, { status: 204 }); }));
    const user = userEvent.setup();
    renderAuth('/reset-password', { recovery_id: recoveryId, email: 'persona@example.test' });
    await user.type(screen.getByLabelText(/^C.digo/i), '123456');
    await user.type(screen.getByLabelText(/^Nueva contrase/i), 'ClaveNueva123');
    await user.type(screen.getByLabelText(/^Confirmar nueva/i), 'ClaveNueva123');
    await user.click(screen.getByRole('button', { name: /Cambiar contrase/i }));
    expect(await screen.findByText(/Contraseña actualizada/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login'), { timeout: 3000 });
    expect(resetStatus).toBe(204);
  });

  // C01-10 completo se verifica en passwordRecovery.test.tsx mediante las pantallas reales.

  it('C01-11: logout 204 limpia sesión, chat y caché, conserva presupuestos y navega a login', async () => {
    const user = userEvent.setup();
    localStorage.setItem('access_token', 'token-activo');
    localStorage.setItem('khipubot_chat_messages', '[]');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(['datos-privados'], { value: 'privado' });
    render(<QueryClientProvider client={queryClient}><AuthRouter initialPath="/ajustes" /></QueryClientProvider>);
    await user.click(screen.getByRole('button', { name: /Cerrar sesi.n/i }));
    expect(await screen.findByRole('heading', { name: /Inicia sesi/ })).toBeInTheDocument();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('khipubot_chat_messages')).toBeNull();
    expect(localStorage.getItem('mock_budgets_v2')).not.toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it.each(['HTTP 500', 'red'])('C01-11: también limpia la sesión local si falla logout por %s', async (failure) => {
    const user = userEvent.setup();
    localStorage.setItem('access_token', 'token-activo');
    localStorage.setItem('khipubot_chat_messages', '[]');
    server.use(http.post('*/api/v1/auth/logout', () => failure === 'red' ? HttpResponse.error() : contractError(500, 'INTERNAL_ERROR', 'Error interno.')));
    renderAuth('/ajustes');
    await user.click(screen.getByRole('button', { name: /Cerrar sesi.n/i }));
    expect(await screen.findByRole('heading', { name: /Inicia sesi/ })).toBeInTheDocument();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('khipubot_chat_messages')).toBeNull();
    expect(localStorage.getItem('mock_budgets_v2')).not.toBeNull();
  });

  it('C01-12: redirige a login al abrir una ruta protegida sin sesión', async () => {
    renderAuth('/historial');
    expect(await screen.findByRole('heading', { name: /Inicia sesi/ })).toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login');
  });

  it('C01-13: redirige a login al recibir 401 SESSION_EXPIRED', async () => {
    server.use(http.get('*/api/v1/protected-resource', () => contractError(401, 'SESSION_EXPIRED', 'La sesión expiró.')));
    localStorage.setItem('access_token', 'token-vencido');
    localStorage.setItem('khipubot_chat_messages', '[]');
    localStorage.setItem('mock_budgets_v2', '[{"preserve":true}]');
    const { queryClient } = renderAuth('/inicio');
    queryClient.setQueryData(['privado'], { value: 'privado' });
    await expect(api('/protected-resource')).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    await waitFor(() => expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login'));
    expect(screen.getByRole('alert')).toHaveTextContent('Tu sesión expiró. Inicia sesión nuevamente.');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('khipubot_chat_messages')).toBeNull();
    expect(localStorage.getItem('mock_budgets_v2')).toBe('[{"preserve":true}]');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login');
  });

  it.each([
    [403, 'ACCOUNT_INACTIVE', 'Tu cuenta está inactiva. Contacta a soporte para recibir ayuda.'],
    [429, 'TOO_MANY_REQUESTS', 'Demasiadas solicitudes. Intenta en 30 s.'],
    [503, 'AUTH_SERVICE_UNAVAILABLE', 'El servicio de autenticación no está disponible.'],
  ])('C01-14: maneja HTTP %i sin crear sesión y conserva el correo', async (status, code, message) => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/auth/login', () => contractError(status, code, message)));
    renderAuth();
    await user.type(screen.getByLabelText(/^Correo/i), 'persona@example.test');
    await user.type(screen.getByLabelText(/^Contrase/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(screen.getByLabelText(/^Correo/i)).toHaveValue('persona@example.test');
    expect(screen.getByLabelText(/^Contrase/i)).toHaveValue('');
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login');
    expect(screen.getByRole('button', { name: /Ingresar a mis finanzas/i })).toBeEnabled();
  });

  it('C01-15: un fallo de red no guarda un token y permite volver a intentar', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(http.post('*/api/v1/auth/login', () => {
      attempts += 1;
      return attempts === 1 ? HttpResponse.error() : HttpResponse.json({ access_token: 'token-reintento' });
    }));
    renderAuth();
    await user.type(screen.getByLabelText(/^Correo/i), 'persona@example.test');
    await user.type(screen.getByLabelText(/^Contrase/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login');

    await user.type(screen.getByLabelText(/^Contrase/i), 'Clave1234');
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(localStorage.getItem('access_token')).toBe('token-reintento');
  });

  it('C01-16: deshabilita el envío mientras el login está pendiente', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    let calls = 0;
    server.use(http.post('*/api/v1/auth/login', async () => {
      calls += 1;
      await pending.promise;
      return HttpResponse.json({ access_token: 'token-unico' });
    }));
    renderAuth();
    await user.type(screen.getByLabelText(/^Correo/i), 'persona@example.test');
    await user.type(screen.getByLabelText(/^Contrase/i), 'Clave1234');
    try {
      await user.dblClick(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
      await waitFor(() => expect(calls).toBe(1));
      expect(screen.getByRole('button', { name: 'Ingresando…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Ingresando…' })).toHaveAttribute('aria-busy', 'true');
      expect(localStorage.getItem('access_token')).toBeNull();
    } finally {
      pending.resolve();
    }
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('C01-17: mostrar u ocultar la contraseña no envía el formulario', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(http.post('*/api/v1/auth/login', () => { calls += 1; return HttpResponse.json({}); }));
    renderAuth();
    await user.type(screen.getByLabelText(/^Contrase/i), 'Clave1234');
    const password = screen.getByLabelText(/^Contrase/i);
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('Clave1234');
    expect(calls).toBe(0);
  });
});

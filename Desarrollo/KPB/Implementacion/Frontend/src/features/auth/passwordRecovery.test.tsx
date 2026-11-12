import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { resetFrontendState } from '../../test/resetFrontendState';
import { contractError, deferred, renderWithTestRouter } from '../../test/cu01Cu02TestUtils';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { LoginPage } from './LoginPage';
import { ProtectedRoute } from './ProtectedRoute';
import { ResetPasswordPage } from './ResetPasswordPage';

const email = 'persona@example.test';
const recoveryId = 'recovery-cu01-1';
const resetToken = 'reset-cu01-1';
const password = 'ClaveNueva123';
const forgotRequest = vi.fn();
const verifyRequest = vi.fn();
const resetRequest = vi.fn();

function renderRecovery(path = '/reset-password', state: unknown = { recovery_id: recoveryId, email }) {
  return renderWithTestRouter(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/recuperar-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}><Route path="/inicio" element={<h1>Inicio privado</h1>} /></Route>
    </Routes>,
    { path, state },
  );
}

function fillReset(values = { code: '123456', password, confirmation: password }) {
  fireEvent.change(screen.getByLabelText(/^Código/i), { target: { value: values.code } });
  fireEvent.change(screen.getByLabelText(/^Nueva contraseña/i), { target: { value: values.password } });
  fireEvent.change(screen.getByLabelText(/^Confirmar nueva/i), { target: { value: values.confirmation } });
}

async function waitForLogin() {
  // Esperar la navegación evita dejar el timeout de éxito vivo entre pruebas.
  await waitFor(() => expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/login'), { timeout: 2500 });
}

beforeEach(() => {
  resetFrontendState();
  vi.clearAllMocks();
  server.use(
    http.post('*/api/v1/auth/password/forgot', async ({ request }) => {
      forgotRequest(await request.json());
      return HttpResponse.json({ recovery_id: recoveryId, code_expires_in_seconds: 60, message: 'Si el correo existe, enviaremos un código.' }, { status: 202 });
    }),
    http.post('*/api/v1/auth/password/verify-code', async ({ request }) => {
      verifyRequest(await request.json());
      return HttpResponse.json({ reset_token: resetToken, reset_token_expires_in_seconds: 300 });
    }),
    http.post('*/api/v1/auth/password/reset', async ({ request }) => {
      resetRequest(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CU01 — recuperación de contraseña (contratos simulados, no persistencia del backend)', () => {
  it('C01-REC-01: redirige a solicitar un código si falta recovery_id', async () => {
    renderRecovery('/reset-password', null);
    expect(await screen.findByRole('button', { name: 'Enviar código' })).toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/recuperar-password');
    expect(verifyRequest).not.toHaveBeenCalled();
    expect(resetRequest).not.toHaveBeenCalled();
  });

  it.each(['', 'correo-inválido', '   '])('C01-REC-02: no solicita recuperación con el correo inválido %j', async (value) => {
    const user = userEvent.setup();
    renderRecovery('/recuperar-password', null);
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value } });
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa un correo electrónico válido.');
    expect(forgotRequest).not.toHaveBeenCalled();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/recuperar-password');
  });

  it.each(['registrado@example.test', 'inexistente@example.test'])('C01-REC-03: presenta el mismo siguiente paso para %s', async (address) => {
    const user = userEvent.setup();
    renderRecovery('/recuperar-password', null);
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: ` ${address} ` } });
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByText('Paso 2 de 2')).toBeInTheDocument();
    expect(screen.getByText('Si el correo existe, enviamos un código de recuperación.')).toBeInTheDocument();
    expect(forgotRequest).toHaveBeenCalledExactlyOnceWith({ email: address });
    fillReset();
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Contraseña actualizada.');
    expect(verifyRequest).toHaveBeenCalledExactlyOnceWith({ recovery_id: recoveryId, code: '123456' });
    expect(resetRequest).toHaveBeenCalledExactlyOnceWith({ reset_token: resetToken, new_password: password, confirm_password: password });
    await waitForLogin();
  });

  it('C01-REC-04: conserva el correo tras un error del servicio y permite reintentar', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(http.post('*/api/v1/auth/password/forgot', async ({ request }) => {
      forgotRequest(await request.json());
      calls += 1;
      return calls === 1
        ? contractError(503, 'AUTH_SERVICE_UNAVAILABLE', 'El servicio no está disponible.')
        : HttpResponse.json({ recovery_id: recoveryId, code_expires_in_seconds: 60 }, { status: 202 });
    }));
    renderRecovery('/recuperar-password', null);
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: email } });
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El servicio no está disponible.');
    expect(screen.getByLabelText(/^Correo/i)).toHaveValue(email);
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/recuperar-password');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByText('Paso 2 de 2')).toBeInTheDocument();
    expect(forgotRequest).toHaveBeenCalledTimes(2);
  });

  it('C01-REC-05: una solicitud pendiente no se duplica al pulsar dos veces', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    server.use(http.post('*/api/v1/auth/password/forgot', async ({ request }) => {
      forgotRequest(await request.json());
      await pending.promise;
      return HttpResponse.json({ recovery_id: recoveryId, code_expires_in_seconds: 60 }, { status: 202 });
    }));
    renderRecovery('/recuperar-password', null);
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: email } });
    try {
      await user.dblClick(screen.getByRole('button', { name: 'Enviar código' }));
      await waitFor(() => expect(forgotRequest).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    } finally {
      pending.resolve();
    }
    expect(await screen.findByText('Paso 2 de 2')).toBeInTheDocument();
    expect(forgotRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'código vacío', code: '', password, confirmation: password, error: 'código de 6 dígitos' },
    { name: 'código incompleto', code: '12345', password, confirmation: password, error: 'código de 6 dígitos' },
    { name: 'código no numérico', code: 'abcdef', password, confirmation: password, error: 'código de 6 dígitos' },
    { name: 'contraseña corta', code: '123456', password: 'Clave12', confirmation: 'Clave12', error: 'al menos 8 caracteres' },
    { name: 'contraseña sin números', code: '123456', password: 'ClaveNueva', confirmation: 'ClaveNueva', error: 'una letra y un número' },
    { name: 'contraseña sin letras', code: '123456', password: '12345678', confirmation: '12345678', error: 'una letra y un número' },
    { name: 'confirmación vacía', code: '123456', password, confirmation: '', error: 'Confirma tu contraseña' },
    { name: 'contraseñas distintas', code: '123456', password, confirmation: 'OtraClave123', error: 'no coinciden' },
  ])('C01-REC-06: valida $name antes de llamar a la API', async ({ error, ...values }) => {
    const user = userEvent.setup();
    renderRecovery();
    fillReset(values);
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent).join(' ')).toContain(error);
    expect(verifyRequest).not.toHaveBeenCalled();
    expect(resetRequest).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'RECOVERY_CODE_INVALID', 'El código no es válido o expiró. Solicita uno nuevo.'],
    [410, 'RECOVERY_CODE_EXPIRED', 'El código no es válido o expiró. Solicita uno nuevo.'],
    [429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Intenta más tarde.'],
    [503, 'AUTH_SERVICE_UNAVAILABLE', 'El código no es válido o expiró. Solicita uno nuevo.'],
  ])('C01-REC-07: un rechazo %i de verificación nunca intenta cambiar la contraseña', async (status, code, message) => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/auth/password/verify-code', async ({ request }) => {
      verifyRequest(await request.json());
      return contractError(status, code, 'No se pudo verificar el código.');
    }));
    renderRecovery();
    fillReset();
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(verifyRequest).toHaveBeenCalledTimes(1);
    expect(resetRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeEnabled();
  });

  it('C01-REC-08: no interpreta un fallo de red en el reset como éxito', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/auth/password/reset', async ({ request }) => {
      resetRequest(await request.json());
      return HttpResponse.error();
    }));
    renderRecovery();
    fillReset();
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(resetRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeEnabled();
  });

  it('C01-REC-09: mantiene el cambio pendiente y no duplica verificar ni restablecer', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    server.use(http.post('*/api/v1/auth/password/reset', async ({ request }) => {
      resetRequest(await request.json());
      await pending.promise;
      return new HttpResponse(null, { status: 204 });
    }));
    renderRecovery();
    fillReset();
    try {
      await user.dblClick(screen.getByRole('button', { name: 'Cambiar contraseña' }));
      await waitFor(() => expect(resetRequest).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Actualizando…' })).toBeDisabled();
      expect(verifyRequest).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      pending.resolve();
    }
    expect(await screen.findByRole('status')).toHaveTextContent('Contraseña actualizada.');
    await waitForLogin();
  });

  it('C01-REC-10: habilita el reenvío a los 60 s y verifica con el recovery_id nuevo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.use(http.post('*/api/v1/auth/password/forgot', async ({ request }) => {
      forgotRequest(await request.json());
      return HttpResponse.json({ recovery_id: 'recovery-cu01-2', code_expires_in_seconds: 60 }, { status: 202 });
    }));
    renderRecovery();
    expect(screen.getByRole('button', { name: 'Reenviar código (60 s)' })).toBeDisabled();
    for (let second = 0; second < 59; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    expect(screen.getByRole('button', { name: 'Reenviar código (1 s)' })).toBeDisabled();
    expect(forgotRequest).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reenviar código' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reenviar código (60 s)' })).toBeDisabled());
    expect(forgotRequest).toHaveBeenCalledExactlyOnceWith({ email });
    fillReset();
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Contraseña actualizada.');
    expect(resetRequest).toHaveBeenCalledTimes(1);
    expect(verifyRequest).toHaveBeenCalledExactlyOnceWith({ recovery_id: 'recovery-cu01-2', code: '123456' });
    await waitForLogin();
  });

  it('C01-REC-11: informa un fallo de reenvío y vuelve a habilitar el botón', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.use(http.post('*/api/v1/auth/password/forgot', () => contractError(503, 'AUTH_SERVICE_UNAVAILABLE', 'No se pudo reenviar el código.')));
    renderRecovery();
    for (let second = 0; second < 60; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo reenviar el código.');
    expect(screen.getByRole('button', { name: 'Reenviar código' })).toBeEnabled();
    expect(screen.getByLabelText('ruta actual')).toHaveTextContent('/reset-password');
  });

  it('C01-10 completo: solicita, verifica, restablece y envía la contraseña nueva al login', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const loginRequest = vi.fn();
    server.use(
      http.post('*/api/v1/auth/password/verify-code', async ({ request }) => {
        order.push('verificar');
        verifyRequest(await request.json());
        return HttpResponse.json({ reset_token: resetToken, reset_token_expires_in_seconds: 300 });
      }),
      http.post('*/api/v1/auth/password/reset', async ({ request }) => {
        order.push('restablecer');
        resetRequest(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('*/api/v1/auth/login', async ({ request }) => {
        order.push('login');
        loginRequest(await request.json());
        return HttpResponse.json({ access_token: 'token-tras-recuperacion', token_type: 'Bearer', inactivity_timeout_seconds: 1200, user: { id: 'user-cu01', email } });
      }),
    );
    renderRecovery('/login', null);
    await user.click(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' }));
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: email } });
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByText('Paso 2 de 2')).toBeInTheDocument();
    fillReset();
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Contraseña actualizada.');
    expect(localStorage.getItem('access_token')).toBeNull();
    await waitForLogin();
    fireEvent.change(screen.getByLabelText(/^Correo/i), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/i), { target: { value: password } });
    await user.click(screen.getByRole('button', { name: /Ingresar a mis finanzas/i }));
    expect(await screen.findByRole('heading', { name: 'Inicio privado' })).toBeInTheDocument();
    expect(order).toEqual(['verificar', 'restablecer', 'login']);
    expect(forgotRequest).toHaveBeenCalledExactlyOnceWith({ email });
    expect(verifyRequest).toHaveBeenCalledExactlyOnceWith({ recovery_id: recoveryId, code: '123456' });
    expect(resetRequest).toHaveBeenCalledExactlyOnceWith({ reset_token: resetToken, new_password: password, confirm_password: password });
    expect(loginRequest).toHaveBeenCalledExactlyOnceWith({ email, password, device: { platform: 'web' } });
    expect(localStorage.getItem('access_token')).toBe('token-tras-recuperacion');
  });

  // Fallos esperados y documentados: el componente atribuye estos errores al código.
  // No son pruebas omitidas: si la aplicación corrige el mensaje, Vitest exige actualizar esta marca.
  it.each([
    ['PASSWORD_MISMATCH', 'Las contraseñas no coinciden.'],
    ['PASSWORD_POLICY_VIOLATION', 'La contraseña no cumple la política mínima definida.'],
  ])('DEFECTO CU01: muestra el mensaje de %s sin atribuirlo al código de recuperación', async (code, message) => {
    const user = userEvent.setup();
    server.use(http.post('*/api/v1/auth/password/reset', () => contractError(422, code, message)));
    renderRecovery();
    fillReset();
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});

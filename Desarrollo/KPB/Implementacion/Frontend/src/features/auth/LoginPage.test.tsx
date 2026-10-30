import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { LoginPage } from './LoginPage';

const apiUrl = 'http://localhost:8000/api/v1';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/inicio" element={<h1>Inicio</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', apiUrl);
  });

  it('valida localmente y no envía si el formulario está mal', async () => {
    const requestSpy = vi.spyOn(globalThis, 'fetch');
    renderLogin();
    fireEvent.change(screen.getByRole('textbox', { name: 'Correo electrónico' }), { target: { value: 'correo-invalido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar a mis finanzas' }));
    expect(await screen.findByText('Ingresa un correo electrónico válido.')).toBeInTheDocument();
    expect(requestSpy).not.toHaveBeenCalled();
    requestSpy.mockRestore();
  });

  it('inicia sesión, guarda el token y redirige', async () => {
    renderLogin();
    fireEvent.change(screen.getByRole('textbox', { name: 'Correo electrónico' }), { target: { value: 'andrea@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Secreta123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar a mis finanzas' }));
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    expect(localStorage.getItem('access_token')).toBe('test-access-token');
  });

  it('muestra el mensaje de credenciales incorrectas (401)', async () => {
    server.use(http.post('*/auth/login', () => HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' } }, { status: 401 })));
    renderLogin();
    fireEvent.change(screen.getByRole('textbox', { name: 'Correo electrónico' }), { target: { value: 'andrea@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'incorrecta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar a mis finanzas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos. Inténtalo de nuevo.');
  });

  it('muestra el mensaje de cuenta bloqueada (423)', async () => {
    server.use(http.post('*/auth/login', () => HttpResponse.json({ error: { code: 'ACCOUNT_LOCKED', message: 'Cuenta bloqueada' } }, { status: 423 })));
    renderLogin();
    fireEvent.change(screen.getByRole('textbox', { name: 'Correo electrónico' }), { target: { value: 'andrea@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Secreta123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar a mis finanzas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu cuenta se bloqueó por 30 minutos. Te enviamos un correo.');
  });

  it('expone labels, botones y enlaces accesibles', () => {
    renderLogin();
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute('href', '/recuperar-password');
    expect(screen.getByRole('link', { name: 'Crear cuenta gratis' })).toHaveAttribute('href', '/registro');
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toBeInTheDocument();
  });
});

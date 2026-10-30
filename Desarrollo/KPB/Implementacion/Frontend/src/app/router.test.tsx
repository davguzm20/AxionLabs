import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './router';

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
}

describe('rutas de la aplicación', () => {
  beforeEach(() => localStorage.clear());

  it('redirige de /inicio a login si no hay token', async () => {
    renderRoute('/inicio');
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
  });

  it('permite acceder a login sin autenticación', () => {
    renderRoute('/login');
    expect(screen.getByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
  });

  it('muestra 404 en una ruta desconocida', () => {
    renderRoute('/xyz');
    expect(screen.getByRole('heading', { name: 'No encontramos esta página' })).toBeInTheDocument();
  });
});

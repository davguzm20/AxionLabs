import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AlertCard } from './AlertCard';

describe('CU08 — contenido visible del aviso en el chat', () => {
  it('muestra porcentaje real y saldo con la moneda recibida', () => {
    render(<MemoryRouter><AlertCard alert={{ message: 'Aviso de prueba.', priority: 'normal', usage_percentage: 80, remaining: '20.00', currency: 'USD' }} /></MemoryRouter>);
    expect(screen.getByText('Consumo: 80% del tope.')).toBeInTheDocument();
    expect(screen.getByText('Saldo disponible: $ 20.00')).toBeInTheDocument();
  });
  it('distingue el límite exacto de un sobregiro', () => {
    render(<MemoryRouter><AlertCard alert={{ message: 'Tope alcanzado.', priority: 'high', usage_percentage: 100, remaining: '0.00', currency: 'PEN' }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Alcanzaste el tope' })).toBeInTheDocument();
    expect(screen.queryByText('¡Presupuesto excedido!')).not.toBeInTheDocument();
  });
  it('muestra el saldo negativo y la recomendación al superar el tope', () => {
    render(<MemoryRouter><AlertCard alert={{ message: 'Sobregiro.', priority: 'high', usage_percentage: 110, remaining: '-10.00', currency: 'PEN' }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '¡Presupuesto excedido!' })).toBeInTheDocument();
    expect(screen.getByText('Saldo disponible: -S/ 10.00')).toBeInTheDocument();
    expect(screen.getByText(/Revisa tus movimientos recientes/)).toBeInTheDocument();
  });
});

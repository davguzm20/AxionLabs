import { renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { resetFrontendState } from '../../../test/resetFrontendState';
import { renderWithTestRouter } from '../../../test/cu01Cu02TestUtils';
import { ClassificationPage } from './ClassificationPage';
import { useClassification } from '../hooks/useClassification';

const categories = [
  { id: 'food', name: 'Alimentación', type: 'expense' },
  { id: 'transport', name: 'Transporte', type: 'expense' },
  { id: 'other', name: 'Otros', type: 'expense' },
];

beforeEach(() => {
  resetFrontendState();
  localStorage.setItem('access_token', 'token-cu05');
});

describe('CU05 — clasificación automática', () => {
  it('carga el catálogo, envía el concepto a sugerencias y permite elegir categoría manualmente', async () => {
    const request = vi.fn();
    server.use(
      http.get('*/api/v1/categories', () => HttpResponse.json({ data: categories })),
      http.post('*/api/v1/categories/suggestions', async ({ request: req }) => {
        request(await req.json());
        return HttpResponse.json({
          category: { id: 'food', name: 'Alimentación', type: 'EXPENSE', icon: 'circle-help' },
          confidence: 0.94,
          reason: 'Concepto relacionado con alimentos.',
          needs_review: false,
          is_fallback: false,
        });
      }),
    );

    const user = userEvent.setup();
    renderWithTestRouter(<ClassificationPage />);

    expect(await screen.findByText('Alimentación')).toBeInTheDocument();
    expect(request).toHaveBeenCalledExactlyOnceWith({ concept: 'Café con leche', amount: '12.00' });
    await user.click(screen.getByRole('button', { name: 'Cambiar categoría' }));
    await user.click(screen.getByRole('button', { name: 'Transporte' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar categoría' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Categoría confirmada: Transporte');
  });

  it('usa Otros como fallback revisable cuando falla NLP', async () => {
    server.use(
      http.get('*/api/v1/categories', () => HttpResponse.json({ data: categories })),
      http.post('*/api/v1/categories/suggestions', () => HttpResponse.json({ error: { code: 'NLP_UNAVAILABLE', message: 'NLP no disponible.' } }, { status: 503 })),
    );

    renderWithTestRouter(<ClassificationPage />);

    expect(await screen.findByText('Otros')).toBeInTheDocument();
    expect(await screen.findByText('No encontramos una coincidencia clara. Revisa la categoría antes de continuar.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar categoría' })).toBeEnabled();
  });

  it('marca is_fallback=true en el resultado de classification cuando falla NLP', async () => {
    server.use(
      http.get('*/api/v1/categories', () => HttpResponse.json({ data: categories })),
      http.post('*/api/v1/categories/suggestions', () => HttpResponse.json({ error: { code: 'NLP_UNAVAILABLE', message: 'NLP no disponible.' } }, { status: 503 })),
    );

    const { result } = renderHook(() => useClassification());
    await waitFor(() => expect(result.current.classification?.is_fallback).toBe(true));
    expect(result.current.classification?.category.name).toBe('Otros');
  });

  it('conserva la categoría fallback si el NLP responde con un id que no está en el catálogo', async () => {
    server.use(
      http.get('*/api/v1/categories', () => HttpResponse.json({ data: categories })),
      http.post('*/api/v1/categories/suggestions', () => HttpResponse.json({
        category: { id: 'unknown', name: 'Categoría desconocida', type: 'EXPENSE', icon: 'circle-help' },
        confidence: 0.8,
        reason: 'Respuesta fuera del catálogo.',
        needs_review: false,
        is_fallback: false,
      })),
    );

    renderWithTestRouter(<ClassificationPage />);
    expect(await screen.findByText('Otros')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar categoría' })).toBeEnabled());
  });

  it('permite reintentar cuando no se puede cargar el catálogo', async () => {
    const categoriesRequest = vi.fn()
      .mockImplementationOnce(() => HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'fallo' } }, { status: 503 }))
      .mockImplementation(() => HttpResponse.json({ data: categories }));
    server.use(
      http.get('*/api/v1/categories', () => categoriesRequest()),
      http.post('*/api/v1/categories/suggestions', () => HttpResponse.json({
        category: { id: 'food', name: 'Alimentación', type: 'EXPENSE', icon: 'circle-help' },
        confidence: 0.9, reason: 'ok', needs_review: false,
      })),
    );
    const user = userEvent.setup();
    renderWithTestRouter(<ClassificationPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos sugerir una categoría. Vuelve a intentarlo.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Alimentación')).toBeInTheDocument();
  });
});

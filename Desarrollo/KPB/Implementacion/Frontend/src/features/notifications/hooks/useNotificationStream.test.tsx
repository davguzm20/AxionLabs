import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../mocks/server';
import { createTestBudget, createTestExpense, mockRequest } from '../../../test/cu07Cu08Api';
import { resetFrontendState } from '../../../test/resetFrontendState';
import {
  NotificationStreamProvider,
  useNotificationStream,
  useNotificationStreamStatus,
} from './useNotificationStream';

const clients = new Set<QueryClient>();
let requests: Request[];

beforeEach(() => {
  resetFrontendState();
  localStorage.setItem('access_token', 'cu07-cu08-token');
  requests = [];
  server.use(http.get('*/api/v1/notifications/stream', ({ request }) => {
    requests.push(request);
    // Observar sin sustituir el stream del mock general.
  }));
});

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
  vi.restoreAllMocks();
});

function createTestClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.add(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

function StreamStatus({ label }: { label: string }) {
  return <span aria-label={label}>{useNotificationStreamStatus()}</span>;
}

describe('CU08 — ciclo de vida del canal de notificaciones con MSW', () => {
  it('abre un canal autenticado y refresca todas las variantes de notificaciones, no los presupuestos', async () => {
    const { client, wrapper } = createTestClient();
    const all = ['notifications', 'ALL', 1];
    const count = ['notifications', 'UNREAD', 'count'];
    const budgets = ['budgets', 'ACTIVE'];
    client.setQueryData(all, { data: [] });
    client.setQueryData(count, { data: [] });
    client.setQueryData(budgets, { data: [] });
    const { result } = renderHook(() => useNotificationStream(), { wrapper });

    await waitFor(() => expect(result.current).toBe('connected'));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer cu07-cu08-token');
    expect(requests[0]?.headers.get('Accept')).toBe('text/event-stream');
    expect(client.getQueryState(all)?.isInvalidated).toBe(true);
    expect(client.getQueryState(count)?.isInvalidated).toBe(true);
    expect(client.getQueryState(budgets)?.isInvalidated).toBe(false);
  });

  it('no abre nuevas conexiones al volver a renderizar el mismo hook', async () => {
    const { wrapper } = createTestClient();
    const { result, rerender } = renderHook(() => useNotificationStream(), { wrapper });
    await waitFor(() => expect(result.current).toBe('connected'));

    rerender();
    rerender();
    expect(result.current).toBe('connected');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal.aborted).toBe(false);
  });

  it('comparte una conexión entre varios consumidores del proveedor', async () => {
    const { wrapper: Wrapper } = createTestClient();
    render(
      <Wrapper>
        <NotificationStreamProvider>
          <StreamStatus label="estado campana" />
          <StreamStatus label="estado bandeja" />
        </NotificationStreamProvider>
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByLabelText('estado campana')).toHaveTextContent('connected'));
    expect(screen.getByLabelText('estado bandeja')).toHaveTextContent('connected');
    expect(requests).toHaveLength(1);
  });

  it('invalida una vez por cada evento real de creación y lectura recibido del mock', async () => {
    await createTestBudget();
    const { client, wrapper } = createTestClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useNotificationStream(), { wrapper });
    await waitFor(() => expect(result.current).toBe('connected'));
    invalidate.mockClear();

    const expense = await createTestExpense('80.00');
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['notifications'] });

    const notificationId = expense.alerts[0]?.notification_id;
    expect(notificationId).toBeTypeOf('string');
    expect((await mockRequest(`/notifications/${notificationId}/read`, 'PATCH')).status).toBe(200);
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['notifications'] });
    expect(requests).toHaveLength(1);
  });

  it('cancela la conexión al desmontarse y deja de reaccionar a nuevos avisos', async () => {
    await createTestBudget();
    const { client, wrapper } = createTestClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result, unmount } = renderHook(() => useNotificationStream(), { wrapper });
    await waitFor(() => expect(result.current).toBe('connected'));
    invalidate.mockClear();
    unmount();

    expect(requests[0]?.signal.aborted).toBe(true);
    await createTestExpense('80.00');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('al montarse de nuevo deja solo el nuevo canal activo y no duplica los eventos', async () => {
    await createTestBudget();
    const { client, wrapper } = createTestClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const first = renderHook(() => useNotificationStream(), { wrapper });
    await waitFor(() => expect(first.result.current).toBe('connected'));
    first.unmount();
    const second = renderHook(() => useNotificationStream(), { wrapper });
    await waitFor(() => expect(second.result.current).toBe('connected'));
    invalidate.mockClear();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]?.signal.aborted).toBe(false);
    await createTestExpense('80.00');
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  });

  it('se reconecta tras un cierre del canal y vuelve a actualizar la bandeja', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    server.use(http.get('*/api/v1/notifications/stream', ({ request }) => {
      requests.push(request);
      return new HttpResponse('retry: 3000\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }, { once: true }));
    const { client, wrapper } = createTestClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result, unmount } = renderHook(() => useNotificationStream(), { wrapper });

    await waitFor(() => expect(result.current).toBe('reconnecting'));
    expect(invalidate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current).toBe('connected'), { timeout: 3_000 });
    expect(requests).toHaveLength(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    unmount();
    expect(requests.every((request) => request.signal.aborted)).toBe(true);
  });

  it('expone el estado desconectado cuando SSE no está disponible sin invalidar datos', async () => {
    const connect = vi.fn(() => new HttpResponse(null, { status: 503 }));
    server.use(http.get('*/api/v1/notifications/stream', connect));
    const { client, wrapper } = createTestClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result, rerender } = renderHook(() => useNotificationStream(), { wrapper });

    await waitFor(() => expect(result.current).toBe('disconnected'));
    rerender();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

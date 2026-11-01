import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';
import type { UserNotification } from '../types/notification.types';

vi.mock('../services/notificationService', () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getUserPreferences: vi.fn(),
  updateEmailNotificationPreference: vi.fn(),
}));

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService';

const seed: UserNotification[] = [
  {
    id: 'notification-1',
    type: 'BUDGET_ALERT',
    title: 'Cruzaste el 80% de tu presupuesto de Salud.',
    body: 'Gastado: S/ 80.00 de S/ 100.00. Te quedan S/ 20.00.',
    status: 'UNREAD',
    alert_id: 'alert-1',
    created_at: new Date().toISOString(),
    read_at: null,
  },
];

let notifications = seed;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><NotificationsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    notifications = seed.map((item) => ({ ...item }));
    vi.mocked(listNotifications).mockImplementation(async (filters = {}) => {
      const filtered = notifications.filter((item) => !filters.status || item.status === filters.status);
      const pageSize = filters.pageSize ?? 20;
      const page = filters.page ?? 1;
      return {
        data: filtered.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, page_size: pageSize, total: filtered.length, pages: Math.ceil(filtered.length / pageSize) },
      };
    });
    vi.mocked(markNotificationRead).mockImplementation(async (id) => {
      notifications = notifications.map((item) => item.id === id
        ? { ...item, status: 'READ', read_at: new Date().toISOString() }
        : item);
      return notifications.find((item) => item.id === id)!;
    });
    vi.mocked(markAllNotificationsRead).mockImplementation(async () => {
      notifications = notifications.map((item) => ({ ...item, status: 'READ', read_at: new Date().toISOString() }));
      return { message: 'Notificaciones marcadas como leídas.' };
    });
  });

  it('shows notifications and marks one as read', async () => {
    renderPage();

    expect(await screen.findByText(seed[0]!.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Marcar como leída: ${seed[0]!.title}` }));

    await waitFor(() => expect(screen.getByText('Leída')).toBeInTheDocument());
    expect(vi.mocked(markNotificationRead).mock.calls[0]?.[0]).toBe('notification-1');
  });

  it('marks every unread notification as read', async () => {
    renderPage();

    const markAllButton = await screen.findByRole('button', { name: 'Marcar todas como leídas' });
    await waitFor(() => expect(markAllButton).toBeEnabled());
    fireEvent.click(markAllButton);

    await waitFor(() => expect(screen.getByText('Leída')).toBeInTheDocument());
    expect(markAllNotificationsRead).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'No leídas' }));
    expect(await screen.findByText('Estás al día.')).toBeInTheDocument();
  });

  it('shows a useful empty state', async () => {
    notifications = [];
    renderPage();

    expect(await screen.findByText('No tienes notificaciones.')).toBeInTheDocument();
  });
});

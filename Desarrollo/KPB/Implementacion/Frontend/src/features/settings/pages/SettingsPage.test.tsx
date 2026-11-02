import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import type { UserPreferences } from '../../notifications/types/notification.types';

vi.mock('../../notifications/services/notificationService', () => ({
  getUserPreferences: vi.fn(),
  updateEmailNotificationPreference: vi.fn(),
}));

import {
  getUserPreferences,
  updateEmailNotificationPreference,
} from '../../notifications/services/notificationService';

describe('SettingsPage notification preference', () => {
  let preferences: UserPreferences;

  beforeEach(() => {
    preferences = { main_currency: 'PEN', email_notifications: true };
    vi.mocked(getUserPreferences).mockImplementation(async () => ({ ...preferences }));
    vi.mocked(updateEmailNotificationPreference).mockImplementation(async (enabled) => {
      preferences = { ...preferences, email_notifications: enabled };
      return { ...preferences };
    });
  });

  it('loads and saves the email preference while keeping in-app alerts active', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><SettingsPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('switch', { name: 'Notificaciones por correo' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Las alertas dentro de la app siempre están activas; este ajuste controla el correo.')).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(vi.mocked(updateEmailNotificationPreference).mock.calls[0]?.[0]).toBe(false);
  });
});

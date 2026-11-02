import { createContext, createElement, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  consumeNotificationStream,
  type NotificationStreamStatus,
} from '../services/notificationStream';
import { notificationsQueryKey } from './useNotifications';

const NotificationStreamContext = createContext<NotificationStreamStatus>('connecting');

export function useNotificationStream() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<NotificationStreamStatus>('connecting');

  useEffect(() => {
    const controller = new AbortController();
    void consumeNotificationStream(controller.signal, () => {
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
    }, setStatus);
    return () => controller.abort();
  }, [queryClient]);

  return status;
}

export function NotificationStreamProvider({ children }: { children: ReactNode }) {
  const status = useNotificationStream();
  return createElement(NotificationStreamContext.Provider, { value: status }, children);
}

export function useNotificationStreamStatus() {
  return useContext(NotificationStreamContext);
}

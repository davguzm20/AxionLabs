import { buildApiUrl, createApiHeaders } from '../../../lib/api';
import type { NotificationStreamEvent } from '../types/notification.types';

export type NotificationStreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type EventHandler = (event: NotificationStreamEvent) => void;

export function parseNotificationFrames(buffer: string): { events: NotificationStreamEvent[]; remainder: string } {
  const frames = buffer.split(/\r?\n\r?\n/u);
  const remainder = frames.pop() ?? '';
  const events = frames.flatMap((frame) => {
    let event: NotificationStreamEvent['event'] | undefined;
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/u)) {
      if (line.startsWith('event:')) {
        const value = line.slice(6).trim();
        if (value === 'alert.created' || value === 'notification.read') event = value;
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).trimStart());
      }
    }
    if (!event || data.length === 0) return [];
    try {
      return [{ event, data: JSON.parse(data.join('\n')) as Record<string, unknown> }];
    } catch {
      return [];
    }
  });
  return { events, remainder };
}

function waitBeforeReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function consumeNotificationStream(
  signal: AbortSignal,
  onEvent: EventHandler,
  onStatus: (status: NotificationStreamStatus) => void,
): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      const response = await fetch(buildApiUrl('/notifications/stream'), {
        method: 'GET',
        headers: createApiHeaders({ Accept: 'text/event-stream' }),
        cache: 'no-store',
        signal,
      });
      if (!response.ok || !response.body) throw new Error('No se pudo abrir el canal de notificaciones.');

      onStatus('connected');
      const connectedAt = Date.now();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseNotificationFrames(buffer);
        buffer = parsed.remainder;
        parsed.events.forEach(onEvent);
      }
      await reader.cancel().catch(() => undefined);
      if (Date.now() - connectedAt >= 30_000) attempt = 0;
    } catch {
      if (signal.aborted) break;
    }

    if (!signal.aborted) {
      attempt += 1;
      onStatus('reconnecting');
      const baseDelay = Math.min(1_000 * (2 ** Math.min(attempt - 1, 5)), 30_000);
      await waitBeforeReconnect(signal, Math.round(baseDelay * (0.8 + Math.random() * 0.4)));
    }
  }
  onStatus('disconnected');
}

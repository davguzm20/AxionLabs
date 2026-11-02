import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeNotificationStream, parseNotificationFrames, type NotificationStreamStatus } from './notificationStream';

describe('parseNotificationFrames', () => {
  it('parses complete events and preserves an incomplete frame', () => {
    const result = parseNotificationFrames(
      'retry: 3000\r\n\r\nevent: alert.created\r\nid: alert-1\r\ndata: {"id":"alert-1",\r\ndata: "percentage":80}\r\n\r\nevent: notification.read\ndata: {"id":"notification-2"}',
    );

    expect(result.events).toEqual([{
      event: 'alert.created',
      data: { id: 'alert-1', percentage: 80 },
    }]);
    expect(result.remainder).toBe('event: notification.read\ndata: {"id":"notification-2"}');
  });

  it('ignores malformed event payloads without breaking the stream', () => {
    const result = parseNotificationFrames('event: alert.created\ndata: {invalid}\n\n');

    expect(result.events).toEqual([]);
    expect(result.remainder).toBe('');
  });

  it('sends the bearer token and consumes an alert event', async () => {
    localStorage.setItem('access_token', 'stream-token');
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer stream-token');
      expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: alert.created\nid: alert-7\ndata: {"id":"alert-7","percentage":80}\n\n'));
          controller.close();
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const abortController = new AbortController();
    const received: unknown[] = [];
    const statuses: NotificationStreamStatus[] = [];
    await consumeNotificationStream(
      abortController.signal,
      (event) => {
        received.push(event);
        abortController.abort();
      },
      (status) => statuses.push(status),
    );

    expect(received).toEqual([{ event: 'alert.created', data: { id: 'alert-7', percentage: 80 } }]);
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

afterEach(() => vi.unstubAllGlobals());

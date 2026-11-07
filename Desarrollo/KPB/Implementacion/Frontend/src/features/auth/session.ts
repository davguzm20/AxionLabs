import type { QueryClient } from '@tanstack/react-query';

export function clearLocalSession(queryClient: QueryClient): void {
  window.localStorage.removeItem('access_token');
  window.localStorage.removeItem('khipubot_chat_messages');
  queryClient.clear();
}

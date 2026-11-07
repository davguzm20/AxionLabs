import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from './app/router';
import { queryClient } from './lib/queryClient';
import { SessionExpiryHandler } from './features/auth/SessionExpiryHandler';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionExpiryHandler />
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

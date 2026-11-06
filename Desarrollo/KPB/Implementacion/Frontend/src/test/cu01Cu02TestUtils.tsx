import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach } from 'vitest';
import { server } from '../mocks/server';
import type { Api10SavedTransactionResponse, TransactionPreview } from '../features/chat/transactionPreview.types';

const clients = new Set<QueryClient>();

// Solo infraestructura de pruebas: nunca comparte la caché de la aplicación.
afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
});

export function renderWithTestRouter(children: ReactNode, options: { path?: string; state?: unknown } = {}) {
  function CurrentLocation() {
    const location = useLocation();
    return <span aria-label="ruta actual">{location.pathname}</span>;
  }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.add(queryClient);
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: options.path ?? '/inicio', state: options.state }]}>
          <CurrentLocation />
          {children}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

export function contractError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, details: [], trace_id: `req_${code}` } }, { status });
}

export const foodCategory = {
  id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'EXPENSE' as const,
};
export const transportCategory = {
  id: '06b43117-bdaa-42e6-9898-230cde8e1002', name: 'Transporte', type: 'EXPENSE' as const,
};
export const salaryCategory = {
  id: '06b43117-bdaa-42e6-9898-230cde8e1003', name: 'Sueldo', type: 'INCOME' as const,
};
export const testWallet = {
  id: '4d6b3036-4290-4bde-aea4-375c779ef48b', name: 'BCP', currency: 'PEN', is_default: true, status: 'ACTIVE',
};

export function makeTextPreview(
  extracted: Partial<TransactionPreview['extracted']> = {},
  overrides: Partial<Omit<TransactionPreview, 'extracted'>> = {},
): TransactionPreview {
  return {
    preview_id: 'preview-cu02-1',
    extracted: {
      type: 'EXPENSE', amount: '15.00', currency: 'PEN', concept: 'Almuerzo',
      transaction_date: '2026-10-15', wallet_id: testWallet.id, category: { ...foodCategory },
      ...extracted,
    },
    confidence: 0.94,
    requires_confirmation: true,
    ...overrides,
  };
}

export function makeSavedTextResponse(preview = makeTextPreview()): Api10SavedTransactionResponse {
  const { extracted } = preview;
  return {
    transaction: {
      id: `saved-${preview.preview_id}`,
      type: extracted.type === 'INCOME' ? 'income' : 'expense',
      amount: extracted.amount ?? '15.00', currency: extracted.currency, concept: extracted.concept,
      category: { id: extracted.category.id, name: extracted.category.name, source: 'suggested' },
      wallet: { id: extracted.wallet_id ?? testWallet.id, name: testWallet.name },
      occurred_at: `${extracted.transaction_date}T12:00:00-05:00`, source: 'text',
    },
    confirmation_message: `Registré ${extracted.amount} en ${extracted.category.name}`,
    balances: {
      wallet: { id: testWallet.id, balance: '170.00' },
      category: { id: extracted.category.id, spent_month: '15.00' },
    },
    budget_alert: null,
  };
}

// Cada suite instala sus propios contratos, sin alterar los mocks de otros CU.
export function installTextHandlers(preview = makeTextPreview(), response = makeSavedTextResponse(preview)) {
  server.use(
    http.get('*/api/v1/categories', () => HttpResponse.json({
      data: [foodCategory, transportCategory, salaryCategory].map((category) => ({
        ...category, type: category.type.toLowerCase(),
      })),
    })),
    http.get('*/api/v1/wallets', () => HttpResponse.json({ data: [{ ...testWallet }] })),
    http.post('*/api/v1/extractions/text', () => HttpResponse.json(preview)),
    http.post('*/api/v1/transactions', () => HttpResponse.json(response, { status: 201 })),
  );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryPage } from './HistoryPage';
import type { HistoryCategory, HistoryFilters, HistoryTransaction } from '../types/history.types';

const historyMocks = vi.hoisted(() => ({
  listTransactions: vi.fn(),
  getTransactionSummary: vi.fn(),
  listHistoryCategories: vi.fn(),
  getTransaction: vi.fn(),
  correctTransaction: vi.fn(),
}));
const walletMocks = vi.hoisted(() => ({ getWallets: vi.fn() }));

vi.mock('../services/historyService', () => historyMocks);
vi.mock('../../wallets/services/walletService', () => walletMocks);

const foodCategory: HistoryCategory = { id: 'food', name: 'Alimentación', icon: 'utensils', type: 'EXPENSE' };
const friendCategory: HistoryCategory = { id: 'friends', name: 'Salidas con amigos', icon: 'users', type: 'EXPENSE' };
const salaryCategory: HistoryCategory = { id: 'salary', name: 'Sueldo', icon: 'wallet', type: 'INCOME' };
const wallet = { id: 'wallet-bcp', name: 'Tarjeta BCP', type: 'bank' as const, currency: 'PEN', balance: '185.00', is_default: true };

function makeTransactions(): HistoryTransaction[] {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = now.getDate() === 1
    ? today
    : `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;
  return [
    { id: 'tx-dinner', type: 'EXPENSE', amount: '120.00', currency: 'PEN', concept: 'Cena', transaction_date: today, wallet_id: wallet.id, category: foodCategory, source: 'TEXT' },
    { id: 'tx-salary', type: 'INCOME', amount: '2500.00', currency: 'PEN', concept: 'Sueldo', transaction_date: yesterday, wallet_id: wallet.id, category: salaryCategory, source: 'TEXT' },
  ];
}

let transactions = makeTransactions();

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><HistoryPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HistoryPage', () => {
  beforeEach(() => {
    transactions = makeTransactions();
    vi.clearAllMocks();
    historyMocks.listTransactions.mockImplementation(async (filters: HistoryFilters, page: number) => {
      const filtered = transactions.filter((transaction) => {
        if (transaction.transaction_date < filters.date_from || transaction.transaction_date > filters.date_to) return false;
        if (filters.type && transaction.type !== filters.type) return false;
        if (filters.category_id && transaction.category.id !== filters.category_id) return false;
        if (filters.wallet_id && transaction.wallet_id !== filters.wallet_id) return false;
        if (filters.q && !transaction.concept.toLocaleLowerCase('es-PE').includes(filters.q.toLocaleLowerCase('es-PE'))) return false;
        return true;
      });
      return { data: filtered.slice((page - 1) * 20, page * 20), meta: { page, page_size: 20, total: filtered.length, pages: Math.ceil(filtered.length / 20) } };
    });
    historyMocks.getTransactionSummary.mockImplementation(async (filters: HistoryFilters) => {
      const filtered = transactions.filter((transaction) => transaction.transaction_date >= filters.date_from && transaction.transaction_date <= filters.date_to && (!filters.type || transaction.type === filters.type));
      const income = filtered.filter((transaction) => transaction.type === 'INCOME').reduce((total, transaction) => total + Number(transaction.amount), 0);
      const expense = filtered.filter((transaction) => transaction.type === 'EXPENSE').reduce((total, transaction) => total + Number(transaction.amount), 0);
      return { date_from: filters.date_from, date_to: filters.date_to, count: filtered.length, by_currency: [{ currency: 'PEN', income: income.toFixed(2), expense: expense.toFixed(2), net: (income - expense).toFixed(2) }] };
    });
    historyMocks.listHistoryCategories.mockResolvedValue([foodCategory, friendCategory, salaryCategory]);
    historyMocks.getTransaction.mockImplementation(async (id: string) => transactions.find((transaction) => transaction.id === id)!);
    historyMocks.correctTransaction.mockImplementation(async (id: string, correction: { category_id?: string; concept?: string }) => {
      const category = [foodCategory, friendCategory, salaryCategory].find((item) => item.id === correction.category_id);
      transactions = transactions.map((transaction) => transaction.id === id ? {
        ...transaction,
        ...(correction.concept ? { concept: correction.concept } : {}),
        ...(category ? { category } : {}),
      } : transaction);
      return transactions.find((transaction) => transaction.id === id)!;
    });
    walletMocks.getWallets.mockResolvedValue([wallet]);
  });

  it('muestra los movimientos agrupados y los totales del mes', async () => {
    renderPage();

    expect(await screen.findByText('Cena')).toBeInTheDocument();
    expect(screen.getByText('S/ 2,500.00')).toBeInTheDocument();
    expect(screen.getByText(/- S\/ 120\.00/u)).toBeInTheDocument();
    expect(screen.getByText('Hoy')).toBeInTheDocument();
    if (new Date().getDate() > 1) expect(screen.getByText('Ayer')).toBeInTheDocument();
  });

  it('combina el filtro de tipo y permite corregir categoría y concepto', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Sueldo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gastos' }));
    await waitFor(() => expect(screen.queryByText('Sueldo')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Cena, gasto de/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Detalle del movimiento' });
    await user.click(screen.getByRole('button', { name: 'Cambiar categoría' }));
    await user.selectOptions(screen.getByLabelText('Categoría'), 'friends');
    await user.click(screen.getByRole('button', { name: 'Editar concepto' }));
    const conceptField = screen.getByLabelText(/Concepto/u);
    await user.clear(conceptField);
    await user.type(conceptField, 'Cena con amigos');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Categoría y concepto actualizados.');
    expect(historyMocks.correctTransaction).toHaveBeenCalledWith('tx-dinner', { category_id: 'friends', concept: 'Cena con amigos' });
    expect(dialog).toBeInTheDocument();
  });
});

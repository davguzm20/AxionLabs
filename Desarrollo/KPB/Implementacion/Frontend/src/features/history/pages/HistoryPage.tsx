import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  CalendarDays,
  Car,
  ChevronRight,
  Funnel,
  RotateCw,
  Search,
  ShoppingCart,
  Tag,
  Tv,
  Utensils,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHistory } from '../hooks/useHistory';
import { getTransaction } from '../services/historyService';
import type { HistoryCategory, HistoryFilters, HistoryTransaction, HistoryTransactionType, TransactionCorrection } from '../types/history.types';

type TypeFilter = 'ALL' | HistoryTransactionType;

function dateForMonth(month: string, lastDay = false): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = lastDay ? new Date(year!, monthNumber!, 0).getDate() : 1;
  return `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' })
    .format(new Date(year!, monthNumber! - 1, 1, 12));
  return label.replace(/^septiembre/u, 'setiembre').replace(/^./u, (letter) => letter.toLocaleUpperCase('es-PE'));
}

function formatMoney(amount: string, currency: string): string {
  const symbol = currency === 'PEN' ? 'S/' : currency === 'USD' ? '$' : currency;
  return `${symbol} ${Number(amount).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(transaction: HistoryTransaction): string {
  const sign = transaction.type === 'INCOME' ? '+' : '-';
  return `${sign} ${formatMoney(transaction.amount, transaction.currency)}`;
}

function dateKeyToDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function groupLabel(value: string): string {
  const date = dateKeyToDate(value);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (key(date) === key(today)) return 'Hoy';
  if (key(date) === key(yesterday)) return 'Ayer';
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long' }).format(date);
}

function CategoryIcon({ category }: { category: string }) {
  const name = category.toLocaleLowerCase('es-PE');
  const props = { 'aria-hidden': true as const, size: 20, className: 'shrink-0 text-ink-600' };
  if (name.includes('aliment') || name.includes('comida')) return <Utensils {...props} />;
  if (name.includes('transport')) return <Car {...props} />;
  if (name.includes('suscrip')) return <Tv {...props} />;
  if (name.includes('sueldo') || name.includes('ingreso')) return <BriefcaseBusiness {...props} />;
  if (name.includes('compra')) return <ShoppingCart {...props} />;
  if (name.includes('amigos')) return <Users {...props} />;
  return <Tag {...props} />;
}

function TransactionRow({ transaction, walletName, onOpen }: {
  transaction: HistoryTransaction;
  walletName: string;
  onOpen: () => void;
}) {
  const isIncome = transaction.type === 'INCOME';
  const categoryName = transaction.category?.name || 'Sin categoría';
  const label = `${transaction.concept}, ${isIncome ? 'ingreso' : 'gasto'} de ${formatMoney(transaction.amount, transaction.currency)}, ${categoryName}, ${walletName}`;
  return (
    <li className="border-b border-ink-300 last:border-b-0">
      <button type="button" aria-label={label} onClick={onOpen} className="flex min-h-[4.5rem] w-full items-center gap-3 py-2 text-left hover:bg-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
        <CategoryIcon category={categoryName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink-900">{transaction.concept || 'Sin concepto'}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-600">{categoryName} · {walletName}</span>
        </span>
        <span className={`shrink-0 text-right font-medium ${isIncome ? 'text-success-700' : 'text-danger-700'}`}>
          <span className="sr-only">{isIncome ? 'Ingreso' : 'Gasto'}: </span>{formatSignedMoney(transaction)}
        </span>
        <ChevronRight aria-hidden="true" size={17} className="shrink-0 text-ink-400" />
      </button>
    </li>
  );
}

function SummaryCards({ summary }: { summary: ReturnType<typeof useHistory>['summary'] }) {
  const summaries = summary.length ? summary : [{ currency: 'PEN', income: '0.00', expense: '0.00', net: '0.00' }];
  return (
    <section aria-label="Totales del periodo" className="space-y-2">
      {summaries.map((item) => (
        <div key={item.currency}>
          {summaries.length > 1 && <h2 className="mb-1 text-xs font-semibold text-ink-600">{item.currency}</h2>}
          <div className="grid grid-cols-2 gap-3">
            <article className="rounded-md border border-ink-200 bg-white px-4 py-2">
              <h3 className="text-xs text-ink-600">Ingresos</h3>
              <p className="mt-0.5 font-semibold text-success-700">{formatMoney(item.income, item.currency)}</p>
            </article>
            <article className="rounded-md border border-ink-200 bg-white px-4 py-2">
              <h3 className="text-xs text-ink-600">Gastos</h3>
              <p className="mt-0.5 font-semibold text-danger-700">{formatMoney(item.expense, item.currency)}</p>
            </article>
          </div>
          <p className="mt-1 text-right text-xs text-ink-600">Saldo neto: <span className="font-semibold text-ink-800">{formatMoney(item.net, item.currency)}</span></p>
        </div>
      ))}
    </section>
  );
}

function HistoryDetailPanel({ transactionId, walletNames, categories, onClose, onSave, isSaving }: {
  transactionId: string;
  walletNames: Map<string, string>;
  categories: HistoryCategory[];
  onClose: () => void;
  onSave: (correction: TransactionCorrection) => Promise<HistoryTransaction>;
  isSaving: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const transactionQuery = useQuery({
    queryKey: ['history', 'transaction', transactionId],
    queryFn: ({ signal }) => getTransaction(transactionId, signal),
  });
  const transaction = transactionQuery.data;
  const [categoryId, setCategoryId] = useState('');
  const [concept, setConcept] = useState('');
  const [editingCategory, setEditingCategory] = useState(false);
  const [editingConcept, setEditingConcept] = useState(false);
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!transaction) return;
    setCategoryId(transaction.category?.id ?? '');
    setConcept(transaction.concept ?? '');
  }, [transaction]);

  useEffect(() => {
    panelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const matchingCategories = categories.filter((category) => !category.type || category.type === transaction?.type);
  const hasChanges = Boolean(transaction) && (
    (editingCategory && categoryId !== transaction?.category?.id)
    || (editingConcept && concept.trim() !== transaction?.concept)
  );

  const saveChanges = async () => {
    if (!transaction || !hasChanges) return;
    const correction: TransactionCorrection = {};
    const categoryChanged = editingCategory && categoryId !== transaction.category?.id;
    const conceptChanged = editingConcept && concept.trim() !== transaction.concept;
    if (categoryChanged) correction.category_id = categoryId;
    if (conceptChanged) correction.concept = concept.trim();
    setActionError('');
    try {
      const updated = await onSave(correction);
      setCategoryId(updated.category?.id ?? '');
      setConcept(updated.concept ?? '');
      setEditingCategory(false);
      setEditingConcept(false);
      setSuccessMessage(categoryChanged && conceptChanged
        ? 'Categoría y concepto actualizados.'
        : categoryChanged ? 'Categoría actualizada.' : 'Concepto actualizado.');
    } catch {
      setActionError('No se pudieron guardar los cambios. Inténtalo de nuevo.');
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-stretch sm:justify-end" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="history-detail-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl focus:outline-none sm:h-full sm:max-h-none sm:max-w-[42rem] sm:rounded-none sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 id="history-detail-title" className="text-lg font-semibold text-ink-900">Detalle del movimiento</h2>
          <button type="button" aria-label="Cerrar detalle" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-md text-ink-600 hover:bg-bg"><X aria-hidden="true" size={20} /></button>
        </div>
        {transactionQuery.isPending ? (
          <p role="status" className="py-8 text-sm text-ink-600">Cargando movimiento…</p>
        ) : transactionQuery.error || !transaction ? (
          <section role="alert" className="mt-5 rounded-lg border border-danger-300 p-4 text-sm text-danger-700">
            <p>No pudimos cargar el detalle.</p>
            <button type="button" onClick={() => void transactionQuery.refetch()} className="mt-2 min-h-11 rounded-md px-3 font-medium text-brand-700 hover:bg-brand-50">Reintentar</button>
          </section>
        ) : (
          <>
            <p className={`mt-5 text-2xl font-semibold ${transaction.type === 'INCOME' ? 'text-success-700' : 'text-danger-700'}`}>{formatSignedMoney(transaction)}</p>
            <p className="mt-1 text-sm text-ink-600">{transaction.concept || 'Sin concepto'}</p>
            {transaction.needs_review && <p className="mt-2 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Por revisar</p>}
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 border-y border-ink-200 py-4 text-sm">
              <dt className="text-ink-500">Fecha</dt><dd>{groupLabel(transaction.transaction_date)} · {transaction.transaction_date}</dd>
              <dt className="text-ink-500">Tipo</dt><dd>{transaction.type === 'INCOME' ? 'Ingreso' : 'Gasto'}</dd>
              <dt className="text-ink-500">Monedero</dt><dd>{walletNames.get(transaction.wallet_id) ?? 'Monedero'}</dd>
              <dt className="text-ink-500">Origen</dt><dd>{({ TEXT: 'Texto', MANUAL: 'Manual', VOICE: 'Voz', RECEIPT: 'Comprobante' } as const)[transaction.source]}</dd>
              {transaction.merchant && <><dt className="text-ink-500">Comercio</dt><dd>{transaction.merchant}</dd></>}
              {transaction.category_confidence != null && <><dt className="text-ink-500">Confianza de categoría</dt><dd>{Math.round(transaction.category_confidence * 100)}%</dd></>}
            </dl>

            <div className="mt-5 space-y-4">
              <div>
                {editingCategory ? (
                  <label className="block text-sm font-medium text-ink-700">
                    Categoría
                    <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3">
                      {matchingCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <p className="text-sm"><span className="text-ink-500">Categoría: </span>{transaction.category?.name || 'Sin categoría'}</p>
                    <button type="button" onClick={() => { setEditingCategory(true); setSuccessMessage(''); }} className="min-h-11 rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">Cambiar categoría</button>
                  </div>
                )}
              </div>
              <div>
                {editingConcept ? (
                  <label className="block text-sm font-medium text-ink-700">
                    Concepto
                    <input value={concept} maxLength={200} onChange={(event) => setConcept(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3" />
                    <span className="mt-1 block text-right text-xs font-normal text-ink-500">{concept.length}/200</span>
                  </label>
                ) : (
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm"><span className="text-ink-500">Concepto: </span>{transaction.concept || 'Sin concepto'}</p>
                    <button type="button" onClick={() => { setEditingConcept(true); setSuccessMessage(''); }} className="min-h-11 shrink-0 rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">Editar concepto</button>
                  </div>
                )}
              </div>
            </div>

            {(editingCategory || editingConcept) && (
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" disabled={isSaving} onClick={() => {
                  setCategoryId(transaction.category?.id ?? '');
                  setConcept(transaction.concept ?? '');
                  setEditingCategory(false);
                  setEditingConcept(false);
                  setActionError('');
                }} className="min-h-11 rounded-md border border-ink-300 px-4 text-sm font-medium text-ink-700 disabled:opacity-50">Cancelar</button>
                <button type="button" disabled={!hasChanges || !concept.trim() || isSaving} onClick={() => void saveChanges()} className="min-h-11 rounded-md bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSaving ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            )}
            {actionError && <p role="alert" className="mt-3 rounded-md border border-danger-300 px-3 py-2 text-sm text-danger-700">{actionError}</p>}
            {successMessage && <p role="status" className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-success-700">{successMessage}</p>}
          </>
        )}
      </section>
    </div>
  );
}

export function HistoryPage() {
  const [month, setMonth] = useState(currentMonth);
  const [type, setType] = useState<TypeFilter>('ALL');
  const [showFilters, setShowFilters] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<HistoryTransaction | null>(null);
  const closeDetail = useCallback(() => setSelected(null), []);

  const filters: HistoryFilters = useMemo(() => ({
    date_from: dateFrom || dateForMonth(month),
    date_to: dateTo || dateForMonth(month, true),
    ...(type !== 'ALL' ? { type } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(walletId ? { wallet_id: walletId } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
  }), [categoryId, dateFrom, dateTo, month, search, type, walletId]);
  const history = useHistory(filters);
  const walletNames = useMemo(() => new Map(history.wallets.map((wallet) => [wallet.id, wallet.name])), [history.wallets]);
  const activeFilterCount = Number(type !== 'ALL') + Number(Boolean(categoryId)) + Number(Boolean(walletId)) + Number(Boolean(dateFrom || dateTo)) + Number(Boolean(search.trim()));
  const groupedTransactions = useMemo(() => {
    const groups = new Map<string, HistoryTransaction[]>();
    for (const transaction of history.transactions) {
      const key = transaction.transaction_date.slice(0, 10);
      groups.set(key, [...(groups.get(key) ?? []), transaction]);
    }
    return [...groups.entries()];
  }, [history.transactions]);
  const noFilters = type === 'ALL' && activeFilterCount === 0;

  const clearFilters = () => {
    setType('ALL');
    setCategoryId('');
    setWalletId('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setMonth(currentMonth());
  };

  return (
    <main className="h-full w-full overflow-y-auto bg-bg px-4 pb-24 sm:px-6 lg:pb-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="sticky top-0 z-10 -mx-4 mb-4 flex min-h-[4.5rem] items-center border-b border-ink-200 bg-white px-4 sm:-mx-6 sm:px-6">
          <h1 className="flex-1 font-semibold text-ink-900">Historial</h1>
        </header>

        <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
          <p aria-live="polite" className="font-medium text-ink-900">{monthLabel(month)}</p>
          <label className="relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-brand-600 hover:bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600" aria-label="Seleccionar mes">
            <CalendarDays aria-hidden="true" size={21} />
            <input
              type="month"
              aria-label="Seleccionar mes"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value || currentMonth());
                setDateFrom('');
                setDateTo('');
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>

        {history.isLoading ? (
          <div role="status" aria-label="Cargando historial" className="space-y-4">
            <div className="grid grid-cols-2 gap-3"><div className="h-14 animate-pulse rounded-md bg-white" /><div className="h-14 animate-pulse rounded-md bg-white" /></div>
            {[0, 1, 2].map((item) => <div key={item} className="h-[4.5rem] animate-pulse rounded-lg bg-white" />)}
            <span className="sr-only">Cargando movimientos…</span>
          </div>
        ) : history.error ? (
          <section role="alert" className="rounded-xl border border-danger-300 bg-white p-5">
            <p className="text-sm text-danger-700">No pudimos cargar tu historial.</p>
            <button type="button" onClick={() => void history.refetch()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">
              <RotateCw aria-hidden="true" size={17} /> Reintentar
            </button>
          </section>
        ) : (
          <>
            <SummaryCards summary={history.summary} />

            <div className="my-4 flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Filtrar movimientos por tipo" className="flex gap-2">
                {(['ALL', 'INCOME', 'EXPENSE'] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)} className={`min-h-11 rounded-full px-4 text-sm font-medium shadow-sm ${type === value ? 'bg-brand-600 text-white' : 'border border-ink-200 bg-white text-ink-700 hover:bg-gray-50'}`}>
                    {value === 'ALL' ? 'Todos' : value === 'INCOME' ? 'Ingresos' : 'Gastos'}
                  </button>
                ))}
              </div>
              <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((current) => !current)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-sm font-medium text-ink-700 hover:bg-gray-50">
                <Funnel aria-hidden="true" size={16} /> Más filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
            </div>

            {showFilters && (
              <section aria-label="Filtros adicionales" className="mb-4 grid gap-3 rounded-xl border border-ink-200 bg-white p-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-ink-700">
                  Categoría
                  <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 font-normal">
                    <option value="">Todas las categorías</option>
                    {history.categories.filter((category) => type === 'ALL' || !category.type || category.type === type).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-ink-700">
                  Monedero
                  <select value={walletId} onChange={(event) => setWalletId(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 font-normal">
                    <option value="">Todos los monederos</option>
                    {history.wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-ink-700">
                  Desde
                  <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 font-normal" />
                </label>
                <label className="text-sm font-medium text-ink-700">
                  Hasta
                  <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 font-normal" />
                </label>
                <label className="text-sm font-medium text-ink-700 sm:col-span-2">
                  Buscar concepto
                  <span className="relative mt-1 block">
                    <Search aria-hidden="true" size={17} className="absolute left-3 top-3.5 text-ink-500" />
                    <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. supermercado" className="min-h-11 w-full rounded-md border border-ink-300 bg-white pl-10 pr-3 font-normal" />
                  </span>
                </label>
                {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="min-h-11 justify-self-start rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-brand-50 sm:col-span-2">Limpiar filtros</button>}
              </section>
            )}

            {history.transactions.length === 0 ? (
              noFilters ? (
                <section className="rounded-xl border border-dashed border-ink-300 bg-white px-5 py-10 text-center">
                  <Wallet aria-hidden="true" className="mx-auto text-ink-500" size={30} />
                  <h2 className="mt-3 font-semibold text-ink-900">Aún no tienes movimientos</h2>
                  <p className="mt-1 text-sm text-ink-600">Registra tu primer gasto en Inicio.</p>
                  <Link to="/inicio" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Ir a Inicio</Link>
                </section>
              ) : (
                <section className="rounded-xl bg-white px-5 py-8 text-center">
                  <p className="text-sm text-ink-600">No encontramos movimientos con esos filtros.</p>
                  <button type="button" onClick={clearFilters} className="mt-2 min-h-11 rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">Limpiar filtros</button>
                </section>
              )
            ) : (
              <div className="mt-4">
                {groupedTransactions.map(([date, transactions]) => (
                  <section key={date} aria-label={groupLabel(date)} className="mb-3">
                    <h2 className="mb-1 pt-1 text-sm font-medium text-ink-900">{groupLabel(date)}</h2>
                    <ul role="list" className="divide-y divide-ink-300">
                      {transactions.map((transaction) => (
                        <TransactionRow
                          key={transaction.id}
                          transaction={transaction}
                          walletName={walletNames.get(transaction.wallet_id) ?? 'Monedero'}
                          onOpen={() => setSelected(transaction)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {history.hasNextPage && (
              <div className="py-4 text-center">
                <button type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()} className="min-h-11 rounded-md border border-ink-300 bg-white px-5 text-sm font-medium text-brand-700 disabled:opacity-50">
                  {history.isFetchingNextPage ? 'Cargando…' : 'Cargar más movimientos'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <HistoryDetailPanel
          transactionId={selected.id}
          walletNames={walletNames}
          categories={history.categories}
          onClose={closeDetail}
          onSave={(correction) => history.correct({ id: selected.id, correction })}
          isSaving={history.isCorrecting}
        />
      )}
    </main>
  );
}

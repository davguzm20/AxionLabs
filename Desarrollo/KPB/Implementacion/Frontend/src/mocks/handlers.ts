import { http, HttpResponse } from 'msw';
import type { Wallet } from '../features/wallets/types/wallet.types';
import type { Budget, BudgetCreatePayload, BudgetPeriodType, BudgetStatus, BudgetThreshold, Currency } from '../features/budgets/types/budget.types';

type TransactionType = 'EXPENSE' | 'INCOME';
type MockCategory = { id: string; name: string; type: TransactionType; icon: string; source?: string; status?: 'ACTIVE' | 'INACTIVE' };
type MockTransaction = {
  id: string;
  type: TransactionType;
  amount: string;
  currency: string;
  concept: string;
  transaction_date: string;
  wallet_id: string;
  category: MockCategory;
  source: 'TEXT' | 'MANUAL' | 'VOICE' | 'RECEIPT';
  needs_review?: boolean;
  created_at?: string;
};
type MockNotification = {
  id: string;
  type: 'BUDGET_ALERT';
  title: string;
  body: string;
  status: 'UNREAD' | 'READ';
  alert_id: string | null;
  created_at: string;
  read_at: string | null;
};
type NotificationEvent = {
  event: 'budget_alert';
  id: string;
  data: Record<string, unknown>;
};

const categoryCatalog: MockCategory[] = [
  { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'EXPENSE', icon: 'utensils' },
  { id: 'category-transport', name: 'Transporte', type: 'EXPENSE', icon: 'bus' },
  { id: 'category-health', name: 'Salud', type: 'EXPENSE', icon: 'heart-pulse' },
  { id: 'category-other', name: 'Otros', type: 'EXPENSE', icon: 'circle-help' },
  { id: 'category-salary', name: 'Sueldo', type: 'INCOME', icon: 'wallet' },
  { id: 'category-freelance', name: 'Freelance', type: 'INCOME', icon: 'laptop' },
  { id: 'category-sales', name: 'Ventas', type: 'INCOME', icon: 'store' },
  { id: 'category-other-income', name: 'Otros', type: 'INCOME', icon: 'circle-help' },
  { id: 'category-friends', name: 'Salidas con amigos', type: 'EXPENSE', icon: 'users' },
  { id: 'category-subscriptions', name: 'Suscripciones', type: 'EXPENSE', icon: 'tv' },
];

const savedTransactions = new Map<string, MockTransaction>();
const savedTextResponses = new Map<string, unknown>();
const savedTransactionResponses = new Map<string, unknown>();
let transactionPostCallCount = 0;
const recoveryIds = new Set<string>();
const resetTokens = new Set<string>();
let savedNotifications: MockNotification[] = [];
let savedPreferences = { main_currency: 'PEN' as const, email_notifications: true };
const notificationSubscribers = new Set<(event: NotificationEvent) => void>();
const mockWalletSeeds: Wallet[] = [
  {
    id: '4d6b3036-4290-4bde-aea4-375c779ef48b',
    name: 'BCP',
    type: 'bank',
    currency: 'PEN',
    balance: '185.00',
    is_default: true,
  },
  {
    id: 'wallet-cash-default',
    name: 'Efectivo',
    type: 'cash',
    currency: 'PEN',
    balance: '150.00',
    is_default: false,
  },
];
const savedWallets: Wallet[] = mockWalletSeeds.map((wallet) => ({ ...wallet }));
const MOCK_TODAY = new Date();
const mockBudgetSeeds = [
  {
    id: 'budget-food', categoryId: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', currency: 'PEN' as const, amount: '250.00', consumed: '0.00', periodType: 'MONTHLY' as const, thresholds: [80, 100],
  },
  {
    id: 'budget-transport', categoryId: 'category-transport', currency: 'PEN' as const, amount: '60.00', consumed: '69.80', periodType: 'MONTHLY' as const, thresholds: [80, 100],
  },
  {
    id: 'budget-friends', categoryId: 'category-friends', currency: 'PEN' as const, amount: '200.00', consumed: '70.00', periodType: 'MONTHLY' as const, thresholds: [90],
  },
];

function centsToMoney(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function dateToString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentBudgetPeriod(periodType: BudgetPeriodType, startDate: string | null, periodDays: number | null) {
  if (periodType === 'WEEKLY') {
    const start = new Date(MOCK_TODAY);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { period_start: dateToString(start), period_end: dateToString(end) };
  }

  if (periodType === 'MONTHLY') {
    const start = new Date(MOCK_TODAY.getFullYear(), MOCK_TODAY.getMonth(), 1, 12);
    const end = new Date(MOCK_TODAY.getFullYear(), MOCK_TODAY.getMonth() + 1, 0, 12);
    return { period_start: dateToString(start), period_end: dateToString(end) };
  }

  const days = periodDays ?? 1;
  const origin = startDate ? new Date(`${startDate}T12:00:00`) : new Date(MOCK_TODAY);
  if (MOCK_TODAY < origin) {
    const end = new Date(origin);
    end.setDate(end.getDate() + days - 1);
    return { period_start: dateToString(origin), period_end: dateToString(end) };
  }
  const elapsedDays = Math.floor((MOCK_TODAY.getTime() - origin.getTime()) / 86_400_000);
  const start = new Date(origin);
  start.setDate(start.getDate() + Math.floor(elapsedDays / days) * days);
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return { period_start: dateToString(start), period_end: dateToString(end) };
}

function makeBudget(input: {
  id: string;
  categoryId: string;
  currency: Currency;
  amount: string;
  consumed: string;
  periodType: BudgetPeriodType;
  startDate?: string | null;
  periodDays?: number | null;
  status?: BudgetStatus;
  thresholds: BudgetThreshold[];
}): Budget {
  const category = categoryCatalog.find((item) => item.id === input.categoryId);
  const amountCents = amountToCents(input.amount);
  const consumedCents = amountToCents(input.consumed);
  const percentage = amountCents === 0n ? 0 : Number((consumedCents * 1_000n) / amountCents) / 10;
  const period = getCurrentBudgetPeriod(input.periodType, input.startDate ?? null, input.periodDays ?? null);

  return {
    id: input.id,
    category: { id: input.categoryId, name: category?.name ?? 'Categoría', type: 'EXPENSE', icon: category?.icon ?? 'circle-help' },
    currency: input.currency,
    amount: input.amount,
    period_type: input.periodType,
    start_date: input.periodType === 'CUSTOM' ? input.startDate ?? null : null,
    period_days: input.periodType === 'CUSTOM' ? input.periodDays ?? null : null,
    period_start: period.period_start,
    period_end: period.period_end,
    consumed: input.consumed,
    remaining: centsToMoney(amountCents - consumedCents),
    percentage,
    status: input.status ?? 'ACTIVE',
    thresholds: input.thresholds,
  };
}

function createSeedBudgets(): Budget[] {
  return mockBudgetSeeds.map((seed) => makeBudget({
    id: seed.id,
    categoryId: seed.categoryId,
    currency: seed.currency,
    amount: seed.amount,
    consumed: seed.consumed,
    periodType: seed.periodType,
    thresholds: seed.thresholds.map((percentage) => ({
      id: `${seed.id}-threshold-${percentage}`,
      percentage,
      triggered: amountToCents(seed.consumed) * 100n >= amountToCents(seed.amount) * BigInt(percentage),
    })),
  }));
}

const MOCK_BUDGETS_STORAGE_KEY = 'mock_budgets_v2';

function loadMockBudgets(): Budget[] {
  if (typeof localStorage === 'undefined') return createSeedBudgets();
  try {
    const serialized = localStorage.getItem(MOCK_BUDGETS_STORAGE_KEY);
    if (!serialized) return createSeedBudgets();
    const parsed = JSON.parse(serialized) as Budget[];
    return Array.isArray(parsed) ? parsed : createSeedBudgets();
  } catch {
    return createSeedBudgets();
  }
}

function persistMockBudgets() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MOCK_BUDGETS_STORAGE_KEY, JSON.stringify(savedBudgets));
  } catch {
    // Storage can be unavailable in private browsing or restricted environments.
  }
}

let savedBudgets = loadMockBudgets();
const today = () => new Date().toISOString().slice(0, 10);
const hasSession = (request: Request) => request.headers.get('Authorization')?.startsWith('Bearer ') ?? false;

function shiftDate(value: Date, days: number): string {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return dateToString(date);
}

function createSeedTransactions(): MockTransaction[] {
  const now = new Date();
  const todayDate = dateToString(now);
  const yesterday = now.getDate() === 1 ? todayDate : shiftDate(now, -1);
  const createdAt = (date: string, time: string) => `${date}T${time}:00-05:00`;
  const seed = (
    id: string,
    type: TransactionType,
    amount: string,
    concept: string,
    transactionDate: string,
    walletId: string,
    categoryId: string,
    time: string,
  ): MockTransaction => ({
    id,
    type,
    amount,
    currency: 'PEN',
    concept,
    transaction_date: transactionDate,
    wallet_id: walletId,
    category: { ...categoryCatalog.find(({ id: categoryKey }) => categoryKey === categoryId)! },
    source: 'MANUAL',
    needs_review: false,
    created_at: createdAt(transactionDate, time),
  });

  return [
    seed('history-dinner', 'EXPENSE', '120.00', 'Cena', todayDate, '4d6b3036-4290-4bde-aea4-375c779ef48b', 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', '19:30'),
    seed('history-uber', 'EXPENSE', '18.50', 'Uber', todayDate, 'wallet-cash-default', 'category-transport', '18:10'),
    seed('history-salary', 'INCOME', '2500.00', 'Sueldo', yesterday, '4d6b3036-4290-4bde-aea4-375c779ef48b', 'category-salary', '09:00'),
    seed('history-market', 'EXPENSE', '86.30', 'Supermercado', yesterday, '4d6b3036-4290-4bde-aea4-375c779ef48b', 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', '08:30'),
    seed('history-netflix', 'EXPENSE', '34.90', 'Netflix', yesterday, '4d6b3036-4290-4bde-aea4-375c779ef48b', 'category-subscriptions', '07:15'),
  ];
}

function resetSavedTransactions() {
  savedTransactions.clear();
  for (const transaction of createSeedTransactions()) savedTransactions.set(transaction.id, transaction);
}

resetSavedTransactions();

export function resetBudgetMocks() {
  savedBudgets = createSeedBudgets();
  persistMockBudgets();
  savedTextResponses.clear();
  savedTransactionResponses.clear();
  transactionPostCallCount = 0;
  resetCu08ThresholdConfigs();
  resetSavedTransactions();
  savedWallets.splice(0, savedWallets.length, ...mockWalletSeeds.map((wallet) => ({ ...wallet })));
  savedNotifications = [];
  savedPreferences = { main_currency: 'PEN', email_notifications: true };
  resetCu08Notifications();
}

export function resetNotificationMocks() {
  savedNotifications = [];
  savedPreferences = { main_currency: 'PEN', email_notifications: true };
  resetCu08Notifications();
}

function publishNotificationEvent(event: NotificationEvent) {
  for (const subscriber of notificationSubscribers) subscriber(event);
}

function mockErrorResponse(status: number, code: string, message: string, details: Array<{ field: string; issue: string }> = []) {
  return HttpResponse.json({
    error: { code, message, details, trace_id: `req_${crypto.randomUUID()}` },
  }, { status });
}

function sessionExpired() {
  return HttpResponse.json(
    { error: { code: 'SESSION_EXPIRED', message: 'Inicia sesión para continuar.', details: [], trace_id: 'req_' + crypto.randomUUID()} },
    { status: 401 },
  );
}

function hasDuplicateWalletName(name: string, excludeId?: string): boolean {
  const normalizedName = name.trim().toLocaleLowerCase('es-PE');
  return savedWallets.some((wallet) => wallet.id !== excludeId && wallet.name.trim().toLocaleLowerCase('es-PE') === normalizedName);
}

function walletResponse(wallet: Wallet) {
  const transactionCount = [...savedTransactions.values()].filter((transaction) => transaction.wallet_id === wallet.id).length;
  return {
    ...wallet,
    type: wallet.type === 'bank' ? 'BANK' : 'CASH',
    current_balance: wallet.balance,
    // Keep this alias for older local consumers while the API contract moves to current_balance.
    balance: wallet.balance,
    status: wallet.status ?? 'ACTIVE',
    has_transactions: transactionCount > 0,
    transaction_count: transactionCount,
  };
}

function amountToCents(amount: string): bigint {
  const [whole = '0', fraction = '00'] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

function spentInMonth(categoryId: string, date: string): string {
  const month = date.slice(0, 7);
  const total = [...savedTransactions.values()]
    .filter((transaction) => transaction.type === 'EXPENSE'
      && transaction.category.id === categoryId
      && transaction.transaction_date.startsWith(month))
    .reduce((sum, transaction) => sum + amountToCents(transaction.amount), 0n);
  return centsToMoney(total);
}

function updateWalletBalance(wallet: Wallet, type: TransactionType, amount: string) {
  const transactionCents = amountToCents(amount);
  const signedCents = type === 'INCOME' ? transactionCents : -transactionCents;
  wallet.balance = centsToMoney(amountToCents(wallet.balance) + signedCents);
}

function isValidBudgetAmount(value: string): boolean {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/u.test(value)) return false;
  const cents = amountToCents(value);
  return cents > 0n && cents <= 9_999_999_999n;
}

function findBudget(id: string): Budget | undefined {
  return savedBudgets.find((budget) => budget.id === id);
}

function hasActiveBudgetForCategory(categoryId: string, exceptId?: string): boolean {
  return savedBudgets.some((budget) => budget.id !== exceptId && budget.category.id === categoryId && budget.status === 'ACTIVE');
}

function toThresholds(budget: Budget): BudgetThreshold[] {
  return budget.thresholds.map((threshold) => ({ ...threshold }));
}

function formatMockMoney(cents: bigint, currency: string): string {
  return `${currency === 'PEN' ? 'S/' : '$'} ${centsToMoney(cents)}`;
}

function evaluateMockBudgetAlerts(input: {
  categoryId: string;
  currency: string;
  amountCents: bigint;
  transactionDate: string;
}): Array<{
  id: string;
  title: string;
  priority: 'high' | 'normal';
  threshold_percentage: number;
  usage_percentage: number;
  message: string;
  notification_id: string;
  category: { id: string; name: string };
  remaining: string;
}> {
  const alerts: Array<{
    id: string;
    title: string;
    priority: 'high' | 'normal';
    threshold_percentage: number;
    usage_percentage: number;
    message: string;
    notification_id: string;
    category: { id: string; name: string };
    remaining: string;
  }> = [];

  for (const budget of savedBudgets) {
    if (budget.status !== 'ACTIVE' || budget.category.id !== input.categoryId || budget.currency !== input.currency) continue;
    if (input.transactionDate < budget.period_start || input.transactionDate > budget.period_end) continue;

    const amountCents = amountToCents(budget.amount);
    const consumedCents = amountToCents(budget.consumed) + input.amountCents;
    budget.consumed = centsToMoney(consumedCents);
    budget.remaining = centsToMoney(amountCents - consumedCents);
    budget.percentage = amountCents === 0n ? 0 : Number((consumedCents * 1_000n) / amountCents) / 10;

    const crossedThresholds = budget.thresholds
      .filter((threshold) => !threshold.triggered
        && consumedCents * 100n >= amountCents * BigInt(threshold.percentage))
      .sort((left, right) => left.percentage - right.percentage);
    crossedThresholds.forEach((threshold) => { threshold.triggered = true; });
    const crossed = crossedThresholds.slice(-1);

    for (const threshold of crossed) {
      const remainingCents = amountCents - consumedCents;
      const title = threshold.percentage === 100 && remainingCents >= 0n
        ? `Alcanzaste el 100% de tu presupuesto de ${budget.category.name}.`
        : `Cruzaste el ${threshold.percentage}% de tu presupuesto de ${budget.category.name}.`;
      const body = remainingCents < 0n
        ? `Superaste tu tope en ${budget.category.name}. Gastado: ${formatMockMoney(consumedCents, budget.currency)} de ${formatMockMoney(amountCents, budget.currency)}.`
        : threshold.percentage === 100
          ? `Límite: ${formatMockMoney(amountCents, budget.currency)}. Gastado: ${formatMockMoney(consumedCents, budget.currency)} de ${formatMockMoney(amountCents, budget.currency)}.`
          : `Gastado: ${formatMockMoney(consumedCents, budget.currency)} de ${formatMockMoney(amountCents, budget.currency)}. Te quedan ${formatMockMoney(remainingCents, budget.currency)}.`;
      const alertId = crypto.randomUUID();
      const notification: MockNotification = {
        id: crypto.randomUUID(),
        type: 'BUDGET_ALERT',
        title,
        body,
        status: 'UNREAD',
        alert_id: alertId,
        created_at: new Date().toISOString(),
        read_at: null,
      };
      savedNotifications.unshift(notification);
      const priority = threshold.percentage === 100 ? 'high' : 'normal';
      const usagePercentage = Number((consumedCents * 1_000n) / amountCents) / 10;
      alerts.push({
        id: alertId,
        title,
        priority,
        threshold_percentage: threshold.percentage,
        usage_percentage: usagePercentage,
        message: body,
        notification_id: notification.id,
        category: { id: budget.category.id, name: budget.category.name },
        remaining: centsToMoney(remainingCents),
      });
      publishNotificationEvent({
        event: 'budget_alert',
        id: alertId,
        data: {
          id: alertId,
          budget_id: budget.id,
          notification_id: notification.id,
          category: budget.category.name,
          percentage: threshold.percentage,
          consumed: centsToMoney(consumedCents),
          limit: budget.amount,
          remaining: centsToMoney(remainingCents),
          priority: priority === 'high' ? 'HIGH' : 'NORMAL',
          created_at: notification.created_at,
        },
      });
    }
  }

  persistMockBudgets();
  return alerts;
}

function findSuggestedCategory(type: TransactionType, concept: string): MockCategory {
  const normalized = concept.toLocaleLowerCase('es-PE');
  const patterns = type === 'INCOME'
    ? [[/sueldo|salario|planilla/, 'category-salary'], [/freelance|servicio/, 'category-freelance'], [/venta|vend[ií]/, 'category-sales']]
    : [[/caf[eé]|\b(?:comida|almuerzo|cena|desayuno|men[uú]|restaurante|pan)\b/u, 'f61d5fcc-730a-48d9-81dc-1db75ce4af16'], [/\b(?:pasaje|taxi|bus|movilidad|combi|metro|transporte)\b/u, 'category-transport'], [/farmacia|doctor|salud|medicina/, 'category-health']];
  const matchedId = patterns.find(([pattern]) => (pattern as RegExp).test(normalized))?.[1] as string | undefined;
  const fallbackId = type === 'INCOME' ? 'category-other-income' : 'category-other';
  const fallback = categoryCatalog.find(({ id }) => id === fallbackId)
    ?? categoryCatalog.find(({ id }) => id === 'category-other')!;
  return categoryCatalog.find(({ id }) => id === matchedId) ?? fallback;
}

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/api/v1/categories', () => HttpResponse.json({
    data: categoryCatalog.map(({ id, name, type }) => ({ id, name, type: type.toLowerCase() })),
  })),
  http.get('*/transactions/summary', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const query = new URL(request.url).searchParams;
    const filtered = [...savedTransactions.values()].filter((transaction) => {
      if (query.get('date_from') && transaction.transaction_date < query.get('date_from')!) return false;
      if (query.get('date_to') && transaction.transaction_date > query.get('date_to')!) return false;
      if (query.get('type') && transaction.type !== query.get('type')) return false;
      if (query.get('category_id') && transaction.category.id !== query.get('category_id')) return false;
      if (query.get('wallet_id') && transaction.wallet_id !== query.get('wallet_id')) return false;
      const search = query.get('q')?.trim().toLocaleLowerCase('es-PE');
      if (search && !transaction.concept.toLocaleLowerCase('es-PE').includes(search)) return false;
      return true;
    });
    const totals = new Map<string, { income: bigint; expense: bigint }>();
    for (const transaction of filtered) {
      const total = totals.get(transaction.currency) ?? { income: 0n, expense: 0n };
      if (transaction.type === 'INCOME') total.income += amountToCents(transaction.amount);
      else total.expense += amountToCents(transaction.amount);
      totals.set(transaction.currency, total);
    }
    return HttpResponse.json({
      date_from: query.get('date_from'),
      date_to: query.get('date_to'),
      count: filtered.length,
      by_currency: [...totals.entries()].map(([currency, total]) => ({
        currency,
        income: centsToMoney(total.income),
        expense: centsToMoney(total.expense),
        net: centsToMoney(total.income - total.expense),
      })),
    });
  }),
  http.get('*/transactions', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const query = new URL(request.url).searchParams;
    const filtered = [...savedTransactions.values()].filter((transaction) => {
      if (query.get('date_from') && transaction.transaction_date < query.get('date_from')!) return false;
      if (query.get('date_to') && transaction.transaction_date > query.get('date_to')!) return false;
      if (query.get('type') && transaction.type !== query.get('type')) return false;
      if (query.get('category_id') && transaction.category.id !== query.get('category_id')) return false;
      if (query.get('wallet_id') && transaction.wallet_id !== query.get('wallet_id')) return false;
      const search = query.get('q')?.trim().toLocaleLowerCase('es-PE');
      if (search && !transaction.concept.toLocaleLowerCase('es-PE').includes(search)) return false;
      return true;
    }).sort((first, second) => {
      const dateOrder = second.transaction_date.localeCompare(first.transaction_date);
      return dateOrder || (second.created_at ?? '').localeCompare(first.created_at ?? '');
    });
    const pageSize = Math.min(100, Math.max(1, Number(query.get('page_size')) || 20));
    const page = Math.max(1, Number(query.get('page')) || 1);
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      data: filtered.slice(start, start + pageSize),
      pagination: { page, page_size: pageSize, total_items: filtered.length, total_pages: Math.ceil(filtered.length / pageSize) },
    });
  }),
  http.get('*/transactions/:id', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const transaction = savedTransactions.get(String(params.id));
    return transaction
      ? HttpResponse.json(transaction)
      : HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró la transacción.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
  }),
  http.get('*/api/v1/users/me/preferences', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    return HttpResponse.json({ ...savedPreferences });
  }),
  http.patch('*/api/v1/users/me/preferences', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const body = await request.json() as { email_notifications?: unknown };
    if (typeof body.email_notifications !== 'boolean') {
      return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'La preferencia de correo debe ser verdadera o falsa.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    savedPreferences = { ...savedPreferences, email_notifications: body.email_notifications };
    return HttpResponse.json({ ...savedPreferences });
  }),
  http.get('*/api/v1/notifications/stream', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (event: NotificationEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event.event}\nid: ${event.id}\ndata: ${JSON.stringify(event.data)}\n\n`));
          } catch {
            close();
          }
        };
        const heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            close();
          }
        }, 25_000);
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          notificationSubscribers.delete(send);
          request.signal.removeEventListener('abort', close);
        };
        cleanup = close;
        notificationSubscribers.add(send);
        controller.enqueue(encoder.encode('retry: 3000\n\n'));
        request.signal.addEventListener('abort', close, { once: true });
      },
      cancel() {
        cleanup();
      },
    });
    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  }),
  http.get('*/api/v1/notifications', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const url = new URL(request.url);
    const usesCu08Format = url.searchParams.has('type') || url.searchParams.has('unread');
    if (usesCu08Format) {
      if (!liveNotificationAdded && Date.now() - mockStartedAt >= 10_000) {
        liveNotificationAdded = true;
        mockCu08Notifications.unshift({
          id: 'notif-live-food-90', type: 'budget_alert', priority: 'normal',
          category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación' }, threshold_percentage: 90,
          usage_percentage: 91.2, spent_month: '456.00', monthly_limit: '500.00', remaining: '44.00',
          message: 'Llegaste al 90% de tu tope en Alimentación. Gastaste S/ 456.00 de S/ 500.00.',
          read: false, created_at: new Date().toISOString(),
        });
      }
      const unread = url.searchParams.get('unread');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size') ?? 20) || 20));
      const filtered = mockCu08Notifications.filter((item) =>
        (!url.searchParams.has('type') || item.type === url.searchParams.get('type'))
        && (unread === null || item.read === (unread !== 'true')),
      );
      const offset = (page - 1) * pageSize;
      return HttpResponse.json({
        data: filtered.slice(offset, offset + pageSize),
        pagination: { page, page_size: pageSize, total_items: filtered.length, total_pages: Math.ceil(filtered.length / pageSize) },
      });
    }
    const status = url.searchParams.get('status');
    if (status && status !== 'UNREAD' && status !== 'READ') {
      return HttpResponse.json({ error: { code: 'INVALID_STATUS', message: 'Selecciona un filtro válido.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get('page_size') ?? 20) || 20));
    const sorted = savedNotifications
      .filter((notification) => !status || notification.status === status)
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'UNREAD' ? -1 : 1;
        return right.created_at.localeCompare(left.created_at);
      });
    const offset = (page - 1) * pageSize;
    const data = sorted.slice(offset, offset + pageSize).map((notification) => ({ ...notification }));
    return HttpResponse.json({
      data,
      meta: { page, page_size: pageSize, total: sorted.length, pages: Math.ceil(sorted.length / pageSize) },
    });
  }),
  http.patch('*/api/v1/notifications/read-all', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const readAt = new Date().toISOString();
    for (const notification of savedNotifications) {
      if (notification.status !== 'UNREAD') continue;
      notification.status = 'READ';
      notification.read_at = readAt;
      const cu08Notification = mockCu08Notifications.find((item) => item.id === notification.id);
      if (cu08Notification) cu08Notification.read = true;
    }
    return HttpResponse.json({ message: 'Notificaciones marcadas como leídas.' });
  }),
  http.patch('*/api/v1/notifications/:notificationId/read', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const notificationId = String(params.notificationId);
    const notification = savedNotifications.find((item) => item.id === notificationId);
    const cu08Notification = mockCu08Notifications.find((item) => item.id === notificationId);
    if (!notification && !cu08Notification) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos esta notificación.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    if (notification?.status === 'UNREAD') {
      notification.status = 'READ';
      notification.read_at = new Date().toISOString();
    }
    if (cu08Notification) cu08Notification.read = true;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/budgets', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? 'ACTIVE';
    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      return HttpResponse.json({ error: { code: 'INVALID_STATUS', message: 'Selecciona un estado válido.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const categoryId = url.searchParams.get('category_id');
    const data = savedBudgets
      .filter((budget) => budget.status === status && (!categoryId || budget.category.id === categoryId))
      .map((budget) => ({ ...budget, category: { ...budget.category }, thresholds: toThresholds(budget) }));
    return HttpResponse.json({ data });
  }),
  http.post('*/api/v1/budgets', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    if (!request.headers.get('Idempotency-Key')) {
      return HttpResponse.json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Falta la clave de idempotencia.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 400 });
    }
    const body = await request.json() as Partial<BudgetCreatePayload>;
    const categoryId = typeof body.category_id === 'string' ? body.category_id : '';
    const category = categoryCatalog.find((item) => item.id === categoryId);
    if (!category) {
      return HttpResponse.json({ error: { code: 'INVALID_CATEGORY', message: 'Selecciona una categoría válida.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (category.type !== 'EXPENSE') {
      return HttpResponse.json({ error: { code: 'INVALID_CATEGORY_TYPE', message: 'El presupuesto solo aplica a gastos.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (hasActiveBudgetForCategory(categoryId)) {
      return HttpResponse.json({ error: { code: 'BUDGET_EXISTS', message: 'Ya tienes un presupuesto para esta categoría.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    }
    if (body.currency !== 'PEN' && body.currency !== 'USD') {
      return HttpResponse.json({ error: { code: 'INVALID_CURRENCY', message: 'Usa PEN o USD.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount)) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto entre 0.01 y 99,999,999.99.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (body.period_type !== 'WEEKLY' && body.period_type !== 'MONTHLY' && body.period_type !== 'CUSTOM') {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD', message: 'Selecciona un periodo válido.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (body.period_type === 'CUSTOM' && (typeof body.start_date !== 'string' || !body.start_date || body.period_days === null || body.period_days === undefined)) {
      return HttpResponse.json({ error: { code: 'CUSTOM_PERIOD_REQUIRED', message: 'Indica fecha de inicio y días.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (body.period_type === 'CUSTOM' && (!Number.isInteger(body.period_days) || Number(body.period_days) < 1 || Number(body.period_days) > 366)) {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD_DAYS', message: 'Los días deben estar entre 1 y 366.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const requestedThresholds = body.thresholds ?? [80];
    if (!Array.isArray(requestedThresholds) || requestedThresholds.length === 0
      || requestedThresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100)
      || new Set(requestedThresholds).size !== requestedThresholds.length) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Ingresa porcentajes únicos entre 1% y 100%.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }

    const id = crypto.randomUUID();
    const budget = makeBudget({
      id,
      categoryId,
      currency: body.currency,
      amount: body.amount,
      consumed: '0.00',
      periodType: body.period_type,
      startDate: body.start_date ?? null,
      periodDays: body.period_days ?? null,
      thresholds: requestedThresholds.map((percentage) => ({
        id: crypto.randomUUID(),
        percentage,
        triggered: false,
      })),
    });
    savedBudgets.push(budget);
    persistMockBudgets();
    return HttpResponse.json(budget, { status: 201 });
  }),
  http.get('*/api/v1/budgets/:budgetId/thresholds', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    return HttpResponse.json({ data: toThresholds(budget) });
  }),
  http.put('*/api/v1/budgets/:budgetId/thresholds', async ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    const body = await request.json() as { thresholds?: unknown };
    const values = body.thresholds;
    if (!Array.isArray(values) || values.length === 0
      || values.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100)
      || new Set(values).size !== values.length) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Ingresa porcentajes únicos entre 1% y 100%.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    budget.thresholds = values.map((percentage) => ({
      id: budget.thresholds.find((threshold) => threshold.percentage === percentage)?.id ?? crypto.randomUUID(),
      percentage,
      triggered: amountToCents(budget.consumed) * 100n >= amountToCents(budget.amount) * BigInt(percentage),
    }));
    persistMockBudgets();
    return HttpResponse.json({ data: toThresholds(budget) });
  }),
  http.post('*/api/v1/budgets/:budgetId/thresholds', async ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    const body = await request.json() as { percentage?: unknown };
    const percentage = body.percentage;
    if (typeof percentage !== 'number' || !Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Ingresa un porcentaje entre 1% y 100%.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (budget.thresholds.some((threshold) => threshold.percentage === percentage)) {
      return HttpResponse.json({ error: { code: 'THRESHOLD_EXISTS', message: 'Ya tienes un umbral con ese porcentaje.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    }
    const threshold: BudgetThreshold = {
      id: crypto.randomUUID(),
      percentage,
      triggered: amountToCents(budget.consumed) * 100n >= amountToCents(budget.amount) * BigInt(percentage),
    };
    budget.thresholds.push(threshold);
    persistMockBudgets();
    return HttpResponse.json(threshold, { status: 201 });
  }),
  http.delete('*/api/v1/budgets/:budgetId/thresholds/:thresholdId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    const nextThresholds = budget.thresholds.filter((threshold) => threshold.id !== String(params.thresholdId));
    if (nextThresholds.length === budget.thresholds.length) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este umbral.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    }
    if (nextThresholds.length === 0) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'El presupuesto debe conservar al menos un umbral.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    budget.thresholds = nextThresholds;
    persistMockBudgets();
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/budgets/:budgetId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    return HttpResponse.json({ ...budget, category: { ...budget.category }, thresholds: toThresholds(budget) });
  }),
  http.patch('*/api/v1/budgets/:budgetId', async ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    const body = await request.json() as Partial<BudgetCreatePayload> & { status?: BudgetStatus };
    if (body.category_id !== undefined || body.currency !== undefined) {
      return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'La categoría y moneda no se pueden cambiar.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (body.status === 'INACTIVE') {
      budget.status = 'INACTIVE';
      persistMockBudgets();
      return HttpResponse.json(budget);
    }
    let nextStatus = budget.status;
    if (body.status === 'ACTIVE') {
      const category = categoryCatalog.find((item) => item.id === budget.category.id);
      if (!category || category.status === 'INACTIVE') {
        return HttpResponse.json({ error: { code: 'CATEGORY_INACTIVE', message: 'La categoría está inactiva.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
      }
      if (hasActiveBudgetForCategory(budget.category.id, budget.id)) {
        return HttpResponse.json({ error: { code: 'BUDGET_EXISTS', message: 'Ya tienes un presupuesto para esta categoría.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
      }
      nextStatus = 'ACTIVE';
    }
    if (body.amount !== undefined && (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount))) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto entre 0.01 y 99,999,999.99.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const periodType = body.period_type ?? budget.period_type;
    if (periodType !== 'WEEKLY' && periodType !== 'MONTHLY' && periodType !== 'CUSTOM') {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD', message: 'Selecciona un periodo válido.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const startDate = periodType === 'CUSTOM' ? body.start_date ?? budget.start_date : null;
    const periodDays = periodType === 'CUSTOM' ? body.period_days ?? budget.period_days : null;
    if (periodType === 'CUSTOM' && (!startDate || !periodDays)) {
      return HttpResponse.json({ error: { code: 'CUSTOM_PERIOD_REQUIRED', message: 'Indica fecha de inicio y días.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (periodType === 'CUSTOM' && (!Number.isInteger(periodDays) || Number(periodDays) < 1 || Number(periodDays) > 366)) {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD_DAYS', message: 'Los días deben estar entre 1 y 366.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    Object.assign(budget, makeBudget({
      id: budget.id,
      categoryId: budget.category.id,
      currency: budget.currency,
      amount: body.amount ?? budget.amount,
      consumed: budget.consumed,
      periodType,
      startDate,
      periodDays,
      status: nextStatus,
      thresholds: budget.thresholds,
    }));
    persistMockBudgets();
    return HttpResponse.json(budget);
  }),
  http.delete('*/api/v1/budgets/:budgetId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    budget.status = 'INACTIVE';
    persistMockBudgets();
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/wallets', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const query = new URL(request.url).searchParams;
    const status = query.get('status');
    const wallets = status ? savedWallets.filter((wallet) => (wallet.status ?? 'ACTIVE') === status) : savedWallets;
    const page = Math.max(1, Number(query.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.get('page_size')) || 20));
    const offset = (page - 1) * pageSize;
    return HttpResponse.json({
      data: wallets.slice(offset, offset + pageSize).map(walletResponse),
      pagination: { page, page_size: pageSize, total_items: wallets.length, total_pages: Math.ceil(wallets.length / pageSize) },
    });
  }),
  http.get('*/api/v1/wallets/:walletId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const wallet = savedWallets.find((item) => item.id === String(params.walletId));
    return wallet
      ? HttpResponse.json(walletResponse(wallet))
      : HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este monedero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
  }),
  http.post('*/api/v1/wallets', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const body = await request.json() as { name?: string; type?: string; currency?: string; initial_balance?: string };
    const name = body.name?.trim() ?? '';
    if (!name) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_EMPTY', message: 'El nombre del monedero no puede estar vacío. Por favor, escoja un nombre apropiado.', details: [], trace_id: 'req_' + crypto.randomUUID()} },
        { status: 422 },
      );
    }
    if (name.length > 50) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_TOO_LONG', message: 'El nombre debe tener 50 caracteres o menos.', details: [], trace_id: 'req_' + crypto.randomUUID()} },
        { status: 422 },
      );
    }
    const type = body.type === 'BANK' || body.type === 'bank' ? 'bank' : body.type === 'CASH' || body.type === 'cash' ? 'cash' : null;
    if (!type || (body.currency !== 'PEN' && body.currency !== 'USD')) {
      return HttpResponse.json(
        { error: { code: 'INVALID_WALLET_DATA', message: 'Selecciona un tipo de monedero y una moneda disponibles.', details: [], trace_id: 'req_' + crypto.randomUUID()} },
        { status: 422 },
      );
    }
    if (hasDuplicateWalletName(name)) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_DUPLICATED', message: 'El nombre del monedero ya está en uso. Por favor, escoja un nombre distinto.', details: [], trace_id: 'req_' + crypto.randomUUID()} },
        { status: 409 },
      );
    }
    const initialBalance = body.initial_balance ?? '0.00';
    const balanceIsValid = typeof initialBalance === 'string'
      && /^\d{1,8}(?:\.\d{1,2})?$/.test(initialBalance)
      && BigInt(initialBalance.split('.')[0] ?? '0') <= 99_999_999n;
    if (!balanceIsValid) {
      return HttpResponse.json(
        { error: { code: 'INVALID_INITIAL_BALANCE', message: 'El saldo inicial debe ser un monto válido mayor o igual a S/ 0.00.', details: [], trace_id: 'req_' + crypto.randomUUID()} },
        { status: 422 },
      );
    }

    const wallet: Wallet = {
      id: crypto.randomUUID(),
      name,
      type,
      currency: body.currency,
      initial_balance: initialBalance,
      balance: initialBalance,
      is_default: !savedWallets.some((item) => item.status !== 'INACTIVE'),
      status: 'ACTIVE',
    };
    savedWallets.push(wallet);
    return HttpResponse.json({
      wallet: walletResponse(wallet),
      confirmation_message: `Monedero “${wallet.name}” creado con saldo inicial de ${wallet.currency === 'PEN' ? 'S/' : '$'} ${wallet.initial_balance}.`,
    }, { status: 201 });
  }),
  http.patch('*/api/v1/wallets/:walletId', async ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const wallet = savedWallets.find((item) => item.id === String(params.walletId));
    if (!wallet) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este monedero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    const body = await request.json() as { name?: string; type?: string; currency?: string; status?: string };
    const name = body.name?.trim();
    const nextType = body.type === undefined ? wallet.type : body.type === 'BANK' || body.type === 'bank' ? 'bank' : body.type === 'CASH' || body.type === 'cash' ? 'cash' : null;
    if (name !== undefined && (!name || name.length > 50)) {
      return HttpResponse.json({ error: { code: 'INVALID_WALLET_NAME', message: 'El nombre debe tener entre 1 y 50 caracteres.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (name && hasDuplicateWalletName(name, wallet.id)) {
      return HttpResponse.json({ error: { code: 'WALLET_NAME_EXISTS', message: 'El nombre del monedero ya está en uso.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    }
    if (!nextType || (body.currency !== undefined && body.currency !== 'PEN' && body.currency !== 'USD')) {
      return HttpResponse.json({ error: { code: 'INVALID_WALLET_DATA', message: 'Selecciona un tipo de monedero y una moneda disponibles.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const transactionCount = [...savedTransactions.values()].filter((transaction) => transaction.wallet_id === wallet.id).length;
    if (body.currency && body.currency !== wallet.currency && transactionCount > 0) {
      return HttpResponse.json({ error: { code: 'WALLET_HAS_TRANSACTIONS', message: 'No puedes cambiar la moneda de un monedero con movimientos.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    }
    if (body.status === 'INACTIVE') {
      if (wallet.is_default) return HttpResponse.json({ error: { code: 'WALLET_IS_DEFAULT', message: 'Primero marca otro monedero como predeterminado.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
      if (savedWallets.filter((item) => item.status !== 'INACTIVE').length <= 1) return HttpResponse.json({ error: { code: 'LAST_WALLET', message: 'Debes tener al menos un monedero activo.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
      wallet.status = 'INACTIVE';
    }
    if (body.status === 'ACTIVE') wallet.status = 'ACTIVE';
    Object.assign(wallet, { ...(name ? { name } : {}), type: nextType, ...(body.currency ? { currency: body.currency } : {}) });
    return HttpResponse.json(walletResponse(wallet));
  }),
  http.delete('*/api/v1/wallets/:walletId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const index = savedWallets.findIndex((item) => item.id === String(params.walletId));
    const wallet = savedWallets[index];
    if (!wallet) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este monedero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    if (wallet.is_default) return HttpResponse.json({ error: { code: 'WALLET_IS_DEFAULT', message: 'Primero marca otro monedero como predeterminado.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    if (savedWallets.filter((item) => item.status !== 'INACTIVE').length <= 1) return HttpResponse.json({ error: { code: 'LAST_WALLET', message: 'Debes tener al menos un monedero activo.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    const transactionCount = [...savedTransactions.values()].filter((transaction) => transaction.wallet_id === wallet.id).length;
    if (transactionCount > 0) wallet.status = 'INACTIVE';
    else savedWallets.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('*/api/v1/wallets/:walletId/default', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const wallet = savedWallets.find((item) => item.id === String(params.walletId));
    if (!wallet) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este monedero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    if (wallet.status === 'INACTIVE') return HttpResponse.json({ error: { code: 'WALLET_INACTIVE', message: 'Reactiva el monedero antes de marcarlo como predeterminado.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    savedWallets.forEach((item) => { item.is_default = item.id === wallet.id; });
    return HttpResponse.json(walletResponse(wallet));
  }),
  http.post('*/api/v1/categories/suggestions', async ({ request }) => {
    const body = await request.json() as { type?: TransactionType; concept?: string };
    const type = body.type ?? 'EXPENSE';
    const category = findSuggestedCategory(type, body.concept ?? '');
    const isFallback = category.name === 'Otros';

    return HttpResponse.json({
      category,
      confidence: isFallback ? 0.3 : 0.94,
      reason: isFallback ? 'No se encontró una coincidencia clara.' : 'El concepto coincide con esta categoría.',
      needs_review: isFallback,
    });
  }),
  http.post('*/api/v1/extractions/text', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const body = await request.json() as { text?: string; wallet_id?: string; client_timezone?: string };
    const text = body.text?.trim() ?? '';
    if (/falla/iu.test(text)) {
      return HttpResponse.json({ error: { code: 'NLP_UNAVAILABLE', message: 'El servicio no esta disponible. Intenta nuevamente.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 503 });
    }
    const amountMatch = text.match(/\d+(?:[.,]\d{1,2})?/u);
    if (!amountMatch) {
      return HttpResponse.json({ error: { code: 'AMOUNT_NOT_DETECTED', message: 'No pude identificar el monto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }

    const [whole = '0', fraction = ''] = amountMatch[0].replace(',', '.').split('.');
    const amount = `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
    const type: TransactionType = /pagaron|ingreso|recib(?:i|\u00ed)|sueldo|freelance|vend(?:i|\u00ed)/iu.test(text) ? 'INCOME' : 'EXPENSE';
    const rawConcept = /^\s*\d+(?:[.,]\d{1,2})?\s*$/u.test(text)
      ? 'Gasto general'
      : text.match(/\b(?:en|por|de)\s+(.+)$/iu)?.[1] ?? text.replace(amountMatch[0], '');
    const concept = rawConcept
      .replace(/\b(?:gast[eé]|pagu[eé]|compr[eé])\b/giu, '')
      .replace(/\b(?:sol(?:es)?|pen|s\/)\b/giu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('es-PE')) || 'Sin concepto';
    const category = findSuggestedCategory(type, concept);
    const wallet = body.wallet_id
      ? savedWallets.find(({ id }) => id === body.wallet_id)
      : savedWallets.find(({ is_default }) => is_default);
    if (!wallet || wallet.status === 'INACTIVE') {
      return HttpResponse.json({ error: { code: 'NO_ACTIVE_WALLET', message: 'Crea un monedero antes de registrar.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    }

    return HttpResponse.json({
      preview_id: crypto.randomUUID(),
      wallet_id: wallet.id,
      extracted: {
        type,
        amount,
        currency: wallet.currency,
        concept,
        transaction_date: today(),
        wallet_id: wallet.id,
        category,
      },
      confidence: 0.94,
      requires_confirmation: true,
    });
  }),
  http.post('*/transactions', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    transactionPostCallCount += 1;
    console.log(`[MSW] POST /transactions call #${transactionPostCallCount}`);
    const idempotencyKey = request.headers.get('Idempotency-Key');
    const body = await request.json() as {
      type: TransactionType | 'expense' | 'income';
      amount: string;
      currency: string;
      concept: string;
      occurred_at?: string;
      wallet_id: string;
      category_id: string;
      category_source: 'manual' | 'suggested';
      source?: string;
      original_text?: string;
    };
    const cachedResponse = idempotencyKey ? savedTransactionResponses.get(idempotencyKey) : undefined;
    if (cachedResponse) return HttpResponse.json(cachedResponse, { status: 201 });
    const type: TransactionType = body.type.toUpperCase() === 'INCOME' ? 'INCOME' : 'EXPENSE';
    const transactionDate = body.occurred_at?.slice(0, 10) ?? today();
    if (body.category_source !== 'manual' && body.category_source !== 'suggested') {
      return mockErrorResponse(422, 'VALIDATION_ERROR', 'Invalid category source.', [{ field: 'category_source', issue: 'required_or_invalid' }]);
    }
    if (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount)) {
      return mockErrorResponse(422, 'VALIDATION_ERROR', 'The amount is invalid.', [{ field: 'amount', issue: 'invalid' }]);
    }
    if (body.currency !== 'PEN' && body.currency !== 'USD') {
      return mockErrorResponse(422, 'VALIDATION_ERROR', 'The currency is invalid.', [{ field: 'currency', issue: 'invalid' }]);
    }
    const wallet = savedWallets.find(({ id }) => id === body.wallet_id);
    if (!wallet) {
      return mockErrorResponse(404, 'WALLET_NOT_FOUND', 'The wallet does not exist or belong to this user.', [{ field: 'wallet_id', issue: 'not_found' }]);
    }
    if (wallet.currency !== body.currency) {
      return mockErrorResponse(422, 'VALIDATION_ERROR', 'The transaction currency does not match the wallet.', [{ field: 'currency', issue: 'mismatch' }]);
    }
    const category = categoryCatalog.find(({ id, type: categoryType }) => id === body.category_id && categoryType === type);
    if (!category) {
      return mockErrorResponse(404, 'CATEGORY_NOT_FOUND', 'The category does not exist in the catalog.', [{ field: 'category_id', issue: 'not_found' }]);
    }

    const transaction: MockTransaction = {
      id: crypto.randomUUID(),
      type,
      amount: body.amount,
      currency: body.currency,
      concept: body.concept,
      transaction_date: transactionDate,
      wallet_id: body.wallet_id,
      category: { ...category, source: body.category_source },
      source: body.source?.toUpperCase() === 'TEXT' ? 'TEXT' : 'MANUAL',
      created_at: new Date().toISOString(),
    };
    savedTransactions.set(transaction.id, transaction);
    updateWalletBalance(wallet, transaction.type, transaction.amount);
    if (type === 'EXPENSE') {
      console.log('[MSW] Applying one accepted transaction to its submitted budget category');
    }
    const alerts = type === 'EXPENSE'
      ? evaluateMockBudgetAlerts({
        categoryId: category.id,
        currency: body.currency,
        amountCents: amountToCents(body.amount),
        transactionDate,
      })
      : [];
    const mockAlert = alerts[0];
    const responseBody = {
      transaction: {
        id: transaction.id,
        type: transaction.type.toLowerCase(),
        amount: transaction.amount,
        currency: transaction.currency,
        concept: transaction.concept,
        category: { id: category.id, name: category.name, source: body.category_source },
        wallet: { id: wallet.id, name: wallet.name },
        occurred_at: body.occurred_at ?? `${transactionDate}T12:00:00-05:00`,
        source: body.source ?? 'manual',
      },
      confirmation_message: `Registr\u00e9 ${body.currency === 'PEN' ? 'S/' : '$'} ${body.amount} en ${category.name}`,
      balances: {
        wallet: { id: wallet.id, balance: wallet.balance },
        category: { id: category.id, spent_month: spentInMonth(category.id, transactionDate) },
      },
      budget_alert: mockAlert ? {
        notification_id: mockAlert.notification_id,
        category: mockAlert.category,
        threshold_percentage: mockAlert.threshold_percentage,
        usage_percentage: mockAlert.usage_percentage,
        remaining: mockAlert.remaining,
        priority: mockAlert.priority,
        message: mockAlert.message,
      } : null,
    };
    if (idempotencyKey) savedTransactionResponses.set(idempotencyKey, responseBody);
    return HttpResponse.json(responseBody, { status: 201 });
  }),
  http.patch('*/transactions/:id', async ({ params, request }) => {
    const transactionId = String(params.id);
    const existingTransaction = savedTransactions.get(transactionId);
    if (!existingTransaction) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró la transacción.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    }

    const body = await request.json() as { category_id?: string; concept?: string };
    const category = categoryCatalog.find(({ id, type }) => id === body.category_id && type === existingTransaction.type);
    if (body.category_id && !category) {
      return HttpResponse.json({ error: { code: 'INVALID_CATEGORY', message: 'La categoría seleccionada no es válida.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }

    const updatedTransaction: MockTransaction = {
      ...existingTransaction,
      ...(body.concept ? { concept: body.concept } : {}),
      ...(category ? { category: { ...category, source: 'manual' } } : {}),
      source: 'MANUAL',
    };
    savedTransactions.set(transactionId, updatedTransaction);
    return HttpResponse.json(updatedTransaction);
  }),
  http.post('*/api/v1/transactions/voice', async ({ request }) => {
    const body = await request.formData();
    const audio = body.get('audio');
    if (!(audio instanceof File)) {
      return HttpResponse.json({ error: { code: 'AUDIO_UNINTELLIGIBLE', message: 'No pude entender el audio. ¿Puedes repetirlo o escribirlo?', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (audio.name.toLowerCase().includes('falla')) {
      return HttpResponse.json({ error: { code: 'STT_UNAVAILABLE', message: 'El servicio de voz no está disponible. Intenta más tarde.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 503 });
    }
    return HttpResponse.json({
      preview_id: 'voice-preview-20261030-001',
      transcript: 'Gasté quince soles en el menú',
      extracted: {
        type: 'EXPENSE',
        amount: '15.00',
        currency: 'PEN',
        concept: 'Menú',
        merchant: null,
        ruc: null,
        transaction_date: today(),
        wallet_id: '4d6b3036-4290-4bde-aea4-375c779ef48b',
        category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', icon: 'utensils', type: 'EXPENSE' },
      },
      confidence: 0.92,
      requires_confirmation: true,
    });
  }),
  http.post('*/api/v1/transactions/voice/confirm', async ({ request }) => {
    const body = await request.json() as {
      type: TransactionType;
      amount: string;
      currency: string;
      concept: string;
      transaction_date: string;
      category_id: string;
      wallet_id: string;
    };
    if (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount)) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto válido mayor que cero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const wallet = savedWallets.find(({ id }) => id === body.wallet_id);
    if (!wallet) {
      return HttpResponse.json({ error: { code: 'NO_ACTIVE_WALLET', message: 'Selecciona un monedero disponible.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (wallet.currency !== body.currency) {
      return HttpResponse.json({ error: { code: 'CURRENCY_MISMATCH', message: 'La moneda de la transacción no coincide con el monedero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const category = categoryCatalog.find(({ id, type }) => id === body.category_id && type === body.type)
      ?? findSuggestedCategory(body.type, '');
    const transaction: MockTransaction = {
      id: crypto.randomUUID(),
      type: body.type,
      amount: body.amount,
      currency: body.currency,
      concept: body.concept,
      transaction_date: body.transaction_date,
      wallet_id: body.wallet_id,
      category,
      source: 'VOICE',
      created_at: new Date().toISOString(),
    };
    savedTransactions.set(transaction.id, transaction);
    updateWalletBalance(wallet, transaction.type, transaction.amount);
    const alerts = body.type === 'EXPENSE'
      ? evaluateMockBudgetAlerts({
        categoryId: category.id,
        currency: body.currency,
        amountCents: amountToCents(body.amount),
        transactionDate: body.transaction_date,
      })
      : [];
    return HttpResponse.json({
      transaction,
      wallet_name: 'BCP',
      alerts,
    }, { status: 201 });
  }),
  http.post('*/api/v1/transactions/receipt', async ({ request }) => {
    const body = await request.formData();
    const image = body.get('image');
    if (!(image instanceof File)) {
      return HttpResponse.json({ error: { code: 'IMAGE_INVALID', message: 'Selecciona una imagen JPG o PNG.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (image.name.toLowerCase().includes('falla')) {
      return HttpResponse.json({ error: { code: 'OCR_UNAVAILABLE', message: 'El servicio de lectura de imágenes no está disponible. Ingresa los datos manualmente.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 503 });
    }
    return HttpResponse.json({
      preview_id: 'receipt-preview-20261031-001',
      ocr_text: 'SUPERMERCADO XYZ\nRUC 20123456789\nTOTAL S/ 45.90',
      extracted: {
        type: 'EXPENSE',
        amount: '45.90',
        currency: 'PEN',
        concept: 'Supermercado XYZ',
        merchant: 'Supermercado XYZ',
        ruc: '20123456789',
        transaction_date: today(),
        wallet_id: '4d6b3036-4290-4bde-aea4-375c779ef48b',
        category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', icon: 'utensils', type: 'EXPENSE' },
      },
      confidence: 0.88,
      requires_confirmation: true,
    });
  }),
  http.post('*/api/v1/transactions/receipt/confirm', async ({ request }) => {
    const body = await request.json() as {
      type: TransactionType;
      amount: string;
      currency: string;
      concept: string;
      transaction_date: string;
      category_id: string;
      wallet_id: string;
    };
    if (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount)) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto válido mayor que cero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const wallet = savedWallets.find(({ id }) => id === body.wallet_id);
    if (!wallet) {
      return HttpResponse.json({ error: { code: 'NO_ACTIVE_WALLET', message: 'Selecciona un monedero disponible.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    if (wallet.currency !== body.currency) {
      return HttpResponse.json({ error: { code: 'CURRENCY_MISMATCH', message: 'La moneda de la transacción no coincide con el monedero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const category = categoryCatalog.find(({ id, type }) => id === body.category_id && type === body.type)
      ?? findSuggestedCategory(body.type, '');
    const transaction: MockTransaction = {
      id: crypto.randomUUID(),
      type: body.type,
      amount: body.amount,
      currency: body.currency,
      concept: body.concept,
      transaction_date: body.transaction_date,
      wallet_id: body.wallet_id,
      category,
      source: 'RECEIPT',
      created_at: new Date().toISOString(),
    };
    savedTransactions.set(transaction.id, transaction);
    updateWalletBalance(wallet, transaction.type, transaction.amount);
    const alerts = body.type === 'EXPENSE'
      ? evaluateMockBudgetAlerts({
        categoryId: category.id,
        currency: body.currency,
        amountCents: amountToCents(body.amount),
        transactionDate: body.transaction_date,
      })
      : [];
    return HttpResponse.json({
      transaction,
      wallet_name: 'BCP',
      alerts,
    }, { status: 201 });
  }),
  http.post('*/api/v1/auth/login', async ({ request }) => {
    const body = await request.json() as { email?: string; password?: string; device?: { platform?: string; name?: string } };
    if (!body.device?.platform) return mockErrorResponse(400, 'VALIDATION_ERROR', 'Indica la plataforma del dispositivo.', [{ field: 'device.platform', issue: 'required' }]);
    if (body.email !== 'demo@test.com' || body.password !== '123456') {
      return HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos. Inténtelo de nuevo.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 401 });
    }

    return HttpResponse.json({
      access_token: 'fake-jwt-token',
      token_type: 'Bearer',
      inactivity_timeout_seconds: 1200,
      user: {
        id: '6a2e2604-2fac-4d0e-b4c3-71cd82b85d80',
        email: body.email,
      },
    });
  }),
  http.post('*/api/v1/auth/logout', ({ request }) => {
    if (!hasSession(request)) return mockErrorResponse(401, 'UNAUTHENTICATED', 'El token de sesiÃ³n es invÃ¡lido o falta.');
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('*/api/v1/auth/password/forgot', async ({ request }) => {
    const body = await request.json() as { email?: string };
    if (!body.email) return mockErrorResponse(400, 'VALIDATION_ERROR', 'El correo es obligatorio.', [{ field: 'email', issue: 'required' }]);
    const recoveryId = crypto.randomUUID();
    recoveryIds.add(recoveryId);
    return HttpResponse.json({
      recovery_id: recoveryId,
      code_expires_in_seconds: 60,
      message: 'Si el correo estÃ¡ registrado, enviaremos un cÃ³digo de recuperaciÃ³n.',
    }, { status: 202 });
  }),
  http.post('*/api/v1/auth/password/verify-code', async ({ request }) => {
    const body = await request.json() as { recovery_id?: string; code?: string };
    if (!body.recovery_id || !body.code || !recoveryIds.has(body.recovery_id)) {
      return mockErrorResponse(400, 'RECOVERY_CODE_INVALID', 'El cÃ³digo ingresado es incorrecto.', [{ field: 'code', issue: 'invalid' }]);
    }
    recoveryIds.delete(body.recovery_id);
    const resetToken = `rst_${crypto.randomUUID()}`;
    resetTokens.add(resetToken);
    return HttpResponse.json({ reset_token: resetToken, reset_token_expires_in_seconds: 300 });
  }),
  http.post('*/api/v1/auth/password/reset', async ({ request }) => {
    const body = await request.json() as { reset_token?: string; new_password?: string; confirm_password?: string };
    if (!body.reset_token || !resetTokens.has(body.reset_token)) {
      return mockErrorResponse(401, 'RESET_TOKEN_INVALID', 'El token de recuperaciÃ³n es invÃ¡lido o venciÃ³.', [{ field: 'reset_token', issue: 'invalid' }]);
    }
    if (body.new_password !== body.confirm_password) {
      return mockErrorResponse(422, 'PASSWORD_MISMATCH', 'Las contraseÃ±as no coinciden.', [{ field: 'confirm_password', issue: 'mismatch' }]);
    }
    resetTokens.delete(body.reset_token);
    return new HttpResponse(null, { status: 204 });
  }),
];

type MockCu08Notification = {
  id: string;
  type: string;
  priority: 'normal' | 'high';
  category: { id: string; name: string };
  threshold_percentage: number;
  usage_percentage: number;
  spent_month: string;
  monthly_limit: string;
  remaining: string;
  message: string;
  read: boolean;
  created_at: string;
};

const thresholdConfigs = new Map(savedBudgets.map((budget) => [budget.category.id, {
  thresholds: budget.thresholds.map((threshold) => threshold.percentage), channels: ['app'], is_default: true,
}]));
const mockStartedAt = Date.now();
let liveNotificationAdded = false;
const mockCu08Notifications: MockCu08Notification[] = [
  {
    id: 'notif-food-75', type: 'budget_alert', priority: 'normal',
    category: { id: 'cat-food', name: 'Alimentación' }, threshold_percentage: 75,
    usage_percentage: 82.16, spent_month: '410.80', monthly_limit: '500.00', remaining: '89.20',
    message: 'Llegaste al 75% de tu tope en Alimentación. Gastaste S/ 410.80 de S/ 500.00.',
    read: false, created_at: new Date(mockStartedAt - 4 * 60_000).toISOString(),
  },
  {
    id: 'notif-transport-100', type: 'budget_alert', priority: 'high',
    category: { id: 'cat-transport', name: 'Transporte' }, threshold_percentage: 100,
    usage_percentage: 105.25, spent_month: '84.20', monthly_limit: '80.00', remaining: '-4.20',
    message: 'Superaste el 100% de tu tope en Transporte. Gastaste S/ 84.20 de S/ 80.00.',
    read: false, created_at: new Date(mockStartedAt - 20 * 60_000).toISOString(),
  },
];

function resetCu08ThresholdConfigs() {
  thresholdConfigs.clear();
  for (const budget of savedBudgets) {
    thresholdConfigs.set(budget.category.id, {
      thresholds: budget.thresholds.map((threshold) => threshold.percentage),
      channels: ['app'],
      is_default: true,
    });
  }
}

function resetCu08Notifications() {
  mockCu08Notifications.splice(0, mockCu08Notifications.length,
    {
      id: 'notif-food-75', type: 'budget_alert', priority: 'normal',
      category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación' }, threshold_percentage: 75,
      usage_percentage: 82.16, spent_month: '410.80', monthly_limit: '500.00', remaining: '89.20',
      message: 'Llegaste al 75% de tu tope en Alimentación. Gastaste S/ 410.80 de S/ 500.00.',
      read: false, created_at: new Date(mockStartedAt - 4 * 60_000).toISOString(),
    },
    {
      id: 'notif-transport-100', type: 'budget_alert', priority: 'high',
      category: { id: 'category-transport', name: 'Transporte' }, threshold_percentage: 100,
      usage_percentage: 105.25, spent_month: '84.20', monthly_limit: '80.00', remaining: '-4.20',
      message: 'Superaste el 100% de tu tope en Transporte. Gastaste S/ 84.20 de S/ 80.00.',
      read: false, created_at: new Date(mockStartedAt - 20 * 60_000).toISOString(),
    },
  );
  liveNotificationAdded = false;
}

handlers.unshift(
  http.post('*/api/v1/transactions/text', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Falta la clave de idempotencia.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const cachedResponse = savedTextResponses.get(idempotencyKey);
    if (cachedResponse) return HttpResponse.json(cachedResponse, { status: 201 });
    const body = await request.json() as { text?: string; wallet_id?: string; client_timezone?: string };
    const text = body.text?.trim() ?? '';

    if (/falla/iu.test(text)) {
      return HttpResponse.json({ error: { code: 'NLP_UNAVAILABLE', message: 'El servicio no está disponible. Intenta nuevamente.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 503 });
    }
    if (text.length === 0 || text.length > 500) {
      return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Escribe entre 1 y 500 caracteres.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }

    const amountMatch = text.match(/\d+(?:[.,]\d{1,2})?/u);
    if (!amountMatch || /\bpan\b/iu.test(text)) {
      return HttpResponse.json({ error: { code: 'AMOUNT_NOT_DETECTED', message: 'No pude identificar el monto. ¿Cuánto fue el gasto/ingreso?', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }

    const [whole = '0', fraction = ''] = amountMatch[0].replace(',', '.').split('.');
    const amount = `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
    if (!isValidBudgetAmount(amount)) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto válido mayor que cero.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }

    const type: TransactionType = /pagaron|ingreso|recib[ií]|sueldo|freelance|vend[ií]/iu.test(text) ? 'INCOME' : 'EXPENSE';
    const concept = text.replace(amountMatch[0], '').replace(/\b(sol(?:es)?|pen|s\/)\b/giu, '').trim() || 'Gasto general';
    const foodCategoryId = 'f61d5fcc-730a-48d9-81dc-1db75ce4af16';
    const category = type === 'EXPENSE' && (amount === '200.00' || amount === '500.00')
      ? categoryCatalog.find(({ id }) => id === foodCategoryId)!
      : findSuggestedCategory(type, concept);
    const wallet = body.wallet_id
      ? savedWallets.find(({ id }) => id === body.wallet_id)
      : savedWallets.find(({ is_default }) => is_default);
    if (!wallet || wallet.status === 'INACTIVE') {
      return HttpResponse.json({ error: { code: 'NO_ACTIVE_WALLET', message: 'Crea un monedero antes de registrar.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 409 });
    }

    const transaction: MockTransaction = {
      id: crypto.randomUUID(),
      type,
      amount,
      currency: wallet.currency,
      concept,
      transaction_date: today(),
      wallet_id: wallet.id,
      category,
      source: 'TEXT',
      created_at: new Date().toISOString(),
    };
    savedTransactions.set(transaction.id, transaction);
    updateWalletBalance(wallet, type, amount);

    const alerts = type === 'EXPENSE'
      ? evaluateMockBudgetAlerts({
        categoryId: category.id,
        currency: wallet.currency,
        amountCents: amountToCents(amount),
        transactionDate: transaction.transaction_date,
      })
      : [];
    const budget_alert = alerts[0];

    const responseBody = {
      transaction,
      wallet_balance: wallet.balance,
      wallet_name: wallet.name,
      ...(budget_alert ? { budget_alert } : {}),
    };
    savedTextResponses.set(idempotencyKey, responseBody);
    return HttpResponse.json(responseBody, { status: 201 });
  }),
  http.get('*/api/v1/budgets/:categoryId/alert-thresholds', ({ params }) => {
    const categoryId = String(params.categoryId);
    const budget = savedBudgets.find((item) => item.category.id === categoryId);
    const config = thresholdConfigs.get(categoryId) ?? (budget ? {
      thresholds: budget.thresholds.map((threshold) => threshold.percentage), channels: ['app'], is_default: true,
    } : undefined);
    if (!config) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró el presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    return HttpResponse.json({ category_id: categoryId, ...config });
  }),
  http.put('*/api/v1/budgets/:categoryId/alert-thresholds', async ({ params, request }) => {
    const categoryId = String(params.categoryId);
    const budget = savedBudgets.find((item) => item.category.id === categoryId);
    if (!budget) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró el presupuesto.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 404 });
    }
    const body = await request.json() as { thresholds?: number[]; channels?: string[] };
    const thresholds = body.thresholds;
    if (!thresholds || thresholds.length < 1 || thresholds.length > 5 || thresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100) || new Set(thresholds).size !== thresholds.length) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Configura entre uno y cinco porcentajes enteros del 1 al 100.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const channels = body.channels ?? ['app'];
    if (channels.some((channel) => !['app', 'email'].includes(channel))) {
      return HttpResponse.json({ error: { code: 'INVALID_CHANNEL', message: 'Selecciona canales válidos.', details: [], trace_id: 'req_' + crypto.randomUUID()} }, { status: 422 });
    }
    const config = { thresholds, channels, is_default: false };
    thresholdConfigs.set(categoryId, config);
    budget.thresholds = thresholds.map((percentage) => ({
      id: budget.thresholds.find((threshold) => threshold.percentage === percentage)?.id ?? crypto.randomUUID(),
      percentage,
      triggered: amountToCents(budget.consumed) * 100n >= amountToCents(budget.amount) * BigInt(percentage),
    }));
    persistMockBudgets();
    return HttpResponse.json({ category_id: categoryId, ...config });
  }),
);

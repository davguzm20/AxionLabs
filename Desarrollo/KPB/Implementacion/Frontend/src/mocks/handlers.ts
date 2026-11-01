import { http, HttpResponse } from 'msw';
import type { CreateWalletPayload, Wallet } from '../features/wallets/types/wallet.types';
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
  event: 'alert.created' | 'notification.read';
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
];

const savedTransactions = new Map<string, MockTransaction>();
let savedNotifications: MockNotification[] = [];
let savedPreferences = { main_currency: 'PEN' as const, email_notifications: true };
const notificationSubscribers = new Set<(event: NotificationEvent) => void>();
const savedWallets: Wallet[] = [
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
const MOCK_TODAY = new Date();
const mockBudgetSeeds = [
  {
    id: 'budget-food', categoryId: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', currency: 'PEN' as const, amount: '500.00', consumed: '410.80', periodType: 'MONTHLY' as const, thresholds: [80],
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

let savedBudgets = createSeedBudgets();
const today = () => new Date().toISOString().slice(0, 10);
const hasSession = (request: Request) => request.headers.get('Authorization')?.startsWith('Bearer ') ?? false;

export function resetBudgetMocks() {
  savedBudgets = createSeedBudgets();
  savedTransactions.clear();
  savedNotifications = [];
  savedPreferences = { main_currency: 'PEN', email_notifications: true };
}

export function resetNotificationMocks() {
  savedNotifications = [];
  savedPreferences = { main_currency: 'PEN', email_notifications: true };
}

function publishNotificationEvent(event: NotificationEvent) {
  for (const subscriber of notificationSubscribers) subscriber(event);
}

function sessionExpired() {
  return HttpResponse.json(
    { error: { code: 'SESSION_EXPIRED', message: 'Inicia sesión para continuar.' } },
    { status: 401 },
  );
}

function hasDuplicateWalletName(name: string, excludeId?: string): boolean {
  const normalizedName = name.trim().toLocaleLowerCase('es-PE');
  return savedWallets.some((wallet) => wallet.id !== excludeId && wallet.name.trim().toLocaleLowerCase('es-PE') === normalizedName);
}

function amountToCents(amount: string): bigint {
  const [whole = '0', fraction = '00'] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
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
}> {
  const alerts: Array<{
    id: string;
    title: string;
    priority: 'high' | 'normal';
    threshold_percentage: number;
    usage_percentage: number;
    message: string;
  }> = [];

  for (const budget of savedBudgets) {
    if (budget.status !== 'ACTIVE' || budget.category.id !== input.categoryId || budget.currency !== input.currency) continue;
    if (input.transactionDate < budget.period_start || input.transactionDate > budget.period_end) continue;

    const amountCents = amountToCents(budget.amount);
    const consumedCents = amountToCents(budget.consumed) + input.amountCents;
    budget.consumed = centsToMoney(consumedCents);
    budget.remaining = centsToMoney(amountCents - consumedCents);
    budget.percentage = amountCents === 0n ? 0 : Number((consumedCents * 1_000n) / amountCents) / 10;

    const crossed = budget.thresholds
      .filter((threshold) => !threshold.triggered
        && consumedCents * 100n >= amountCents * BigInt(threshold.percentage))
      .sort((left, right) => left.percentage - right.percentage);

    for (const threshold of crossed) {
      threshold.triggered = true;
      const remainingCents = amountCents - consumedCents;
      const overspentCents = remainingCents < 0n ? -remainingCents : 0n;
      const title = threshold.percentage === 100 && remainingCents >= 0n
        ? `Alcanzaste el 100% de tu presupuesto de ${budget.category.name}.`
        : `Cruzaste el ${threshold.percentage}% de tu presupuesto de ${budget.category.name}.`;
      const body = remainingCents < 0n
        ? `Superaste tu presupuesto en ${formatMockMoney(overspentCents, budget.currency)}. Gastado: ${formatMockMoney(consumedCents, budget.currency)} de ${formatMockMoney(amountCents, budget.currency)}.`
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
        message: `${title} ${body}`,
      });
      publishNotificationEvent({
        event: 'alert.created',
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

  return alerts;
}

function findSuggestedCategory(type: TransactionType, concept: string): MockCategory {
  const normalized = concept.toLocaleLowerCase('es-PE');
  const patterns = type === 'INCOME'
    ? [[/sueldo|salario|planilla/, 'category-salary'], [/freelance|servicio/, 'category-freelance'], [/venta|vend[ií]/, 'category-sales']]
    : [[/caf[eé]|almuerzo|cena|comida|men[uú]|restaurante/, 'f61d5fcc-730a-48d9-81dc-1db75ce4af16'], [/taxi|bus|pasaje|metro|transporte/, 'category-transport'], [/farmacia|doctor|salud|medicina/, 'category-health']];
  const matchedId = patterns.find(([pattern]) => (pattern as RegExp).test(normalized))?.[1] as string | undefined;
  const fallbackId = type === 'INCOME' ? 'category-other-income' : 'category-other';
  return categoryCatalog.find(({ id }) => id === (matchedId ?? fallbackId)) ?? categoryCatalog[0]!;
}

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/api/v1/categories', () => HttpResponse.json(categoryCatalog.map((category) => ({ ...category, status: 'ACTIVE' })))),
  http.get('*/api/v1/users/me/preferences', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    return HttpResponse.json({ ...savedPreferences });
  }),
  http.patch('*/api/v1/users/me/preferences', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const body = await request.json() as { email_notifications?: unknown };
    if (typeof body.email_notifications !== 'boolean') {
      return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'La preferencia de correo debe ser verdadera o falsa.' } }, { status: 422 });
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
    const status = url.searchParams.get('status');
    if (status && status !== 'UNREAD' && status !== 'READ') {
      return HttpResponse.json({ error: { code: 'INVALID_STATUS', message: 'Selecciona un filtro válido.' } }, { status: 422 });
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
      publishNotificationEvent({
        event: 'notification.read',
        id: notification.id,
        data: { id: notification.id, status: 'READ' },
      });
    }
    return HttpResponse.json({ message: 'Notificaciones marcadas como leídas.' });
  }),
  http.patch('*/api/v1/notifications/:notificationId/read', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const notification = savedNotifications.find((item) => item.id === String(params.notificationId));
    if (!notification) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos esta notificación.' } }, { status: 404 });
    if (notification.status === 'UNREAD') {
      notification.status = 'READ';
      notification.read_at = new Date().toISOString();
      publishNotificationEvent({
        event: 'notification.read',
        id: notification.id,
        data: { id: notification.id, status: 'READ' },
      });
    }
    return HttpResponse.json({ ...notification });
  }),
  http.get('*/api/v1/budgets', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? 'ACTIVE';
    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      return HttpResponse.json({ error: { code: 'INVALID_STATUS', message: 'Selecciona un estado válido.' } }, { status: 422 });
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
      return HttpResponse.json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Falta la clave de idempotencia.' } }, { status: 400 });
    }
    const body = await request.json() as Partial<BudgetCreatePayload>;
    const categoryId = typeof body.category_id === 'string' ? body.category_id : '';
    const category = categoryCatalog.find((item) => item.id === categoryId);
    if (!category) {
      return HttpResponse.json({ error: { code: 'INVALID_CATEGORY', message: 'Selecciona una categoría válida.' } }, { status: 422 });
    }
    if (category.type !== 'EXPENSE') {
      return HttpResponse.json({ error: { code: 'INVALID_CATEGORY_TYPE', message: 'El presupuesto solo aplica a gastos.' } }, { status: 422 });
    }
    if (hasActiveBudgetForCategory(categoryId)) {
      return HttpResponse.json({ error: { code: 'BUDGET_EXISTS', message: 'Ya tienes un presupuesto para esta categoría.' } }, { status: 409 });
    }
    if (body.currency !== 'PEN' && body.currency !== 'USD') {
      return HttpResponse.json({ error: { code: 'INVALID_CURRENCY', message: 'Usa PEN o USD.' } }, { status: 422 });
    }
    if (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount)) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto entre 0.01 y 99,999,999.99.' } }, { status: 422 });
    }
    if (body.period_type !== 'WEEKLY' && body.period_type !== 'MONTHLY' && body.period_type !== 'CUSTOM') {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD', message: 'Selecciona un periodo válido.' } }, { status: 422 });
    }
    if (body.period_type === 'CUSTOM' && (typeof body.start_date !== 'string' || !body.start_date || body.period_days === null || body.period_days === undefined)) {
      return HttpResponse.json({ error: { code: 'CUSTOM_PERIOD_REQUIRED', message: 'Indica fecha de inicio y días.' } }, { status: 422 });
    }
    if (body.period_type === 'CUSTOM' && (!Number.isInteger(body.period_days) || Number(body.period_days) < 1 || Number(body.period_days) > 366)) {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD_DAYS', message: 'Los días deben estar entre 1 y 366.' } }, { status: 422 });
    }
    const requestedThresholds = body.thresholds ?? [80];
    if (!Array.isArray(requestedThresholds) || requestedThresholds.length === 0
      || requestedThresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100)
      || new Set(requestedThresholds).size !== requestedThresholds.length) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Ingresa porcentajes únicos entre 1% y 100%.' } }, { status: 422 });
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
    return HttpResponse.json(budget, { status: 201 });
  }),
  http.get('*/api/v1/budgets/:budgetId/thresholds', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.' } }, { status: 404 });
    return HttpResponse.json({ data: toThresholds(budget) });
  }),
  http.put('*/api/v1/budgets/:budgetId/thresholds', async ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.' } }, { status: 404 });
    const body = await request.json() as { thresholds?: unknown };
    const values = body.thresholds;
    if (!Array.isArray(values) || values.length === 0
      || values.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100)
      || new Set(values).size !== values.length) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Ingresa porcentajes únicos entre 1% y 100%.' } }, { status: 422 });
    }
    budget.thresholds = values.map((percentage) => ({
      id: budget.thresholds.find((threshold) => threshold.percentage === percentage)?.id ?? crypto.randomUUID(),
      percentage,
      triggered: amountToCents(budget.consumed) * 100n >= amountToCents(budget.amount) * BigInt(percentage),
    }));
    return HttpResponse.json({ data: toThresholds(budget) });
  }),
  http.post('*/api/v1/budgets/:budgetId/thresholds', async ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.' } }, { status: 404 });
    const body = await request.json() as { percentage?: unknown };
    const percentage = body.percentage;
    if (typeof percentage !== 'number' || !Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Ingresa un porcentaje entre 1% y 100%.' } }, { status: 422 });
    }
    if (budget.thresholds.some((threshold) => threshold.percentage === percentage)) {
      return HttpResponse.json({ error: { code: 'THRESHOLD_EXISTS', message: 'Ya tienes un umbral con ese porcentaje.' } }, { status: 409 });
    }
    const threshold: BudgetThreshold = {
      id: crypto.randomUUID(),
      percentage,
      triggered: amountToCents(budget.consumed) * 100n >= amountToCents(budget.amount) * BigInt(percentage),
    };
    budget.thresholds.push(threshold);
    return HttpResponse.json(threshold, { status: 201 });
  }),
  http.delete('*/api/v1/budgets/:budgetId/thresholds/:thresholdId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.' } }, { status: 404 });
    const nextThresholds = budget.thresholds.filter((threshold) => threshold.id !== String(params.thresholdId));
    if (nextThresholds.length === budget.thresholds.length) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este umbral.' } }, { status: 404 });
    }
    if (nextThresholds.length === 0) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'El presupuesto debe conservar al menos un umbral.' } }, { status: 422 });
    }
    budget.thresholds = nextThresholds;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/budgets/:budgetId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.' } }, { status: 404 });
    return HttpResponse.json({ ...budget, category: { ...budget.category }, thresholds: toThresholds(budget) });
  }),
  http.patch('*/api/v1/budgets/:budgetId', async ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.' } }, { status: 404 });
    const body = await request.json() as Partial<BudgetCreatePayload> & { status?: BudgetStatus };
    if (body.category_id !== undefined || body.currency !== undefined) {
      return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'La categoría y moneda no se pueden cambiar.' } }, { status: 422 });
    }
    if (body.status === 'INACTIVE') {
      budget.status = 'INACTIVE';
      return HttpResponse.json(budget);
    }
    let nextStatus = budget.status;
    if (body.status === 'ACTIVE') {
      const category = categoryCatalog.find((item) => item.id === budget.category.id);
      if (!category || category.status === 'INACTIVE') {
        return HttpResponse.json({ error: { code: 'CATEGORY_INACTIVE', message: 'La categoría está inactiva.' } }, { status: 409 });
      }
      if (hasActiveBudgetForCategory(budget.category.id, budget.id)) {
        return HttpResponse.json({ error: { code: 'BUDGET_EXISTS', message: 'Ya tienes un presupuesto para esta categoría.' } }, { status: 409 });
      }
      nextStatus = 'ACTIVE';
    }
    if (body.amount !== undefined && (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount))) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto entre 0.01 y 99,999,999.99.' } }, { status: 422 });
    }
    const periodType = body.period_type ?? budget.period_type;
    if (periodType !== 'WEEKLY' && periodType !== 'MONTHLY' && periodType !== 'CUSTOM') {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD', message: 'Selecciona un periodo válido.' } }, { status: 422 });
    }
    const startDate = periodType === 'CUSTOM' ? body.start_date ?? budget.start_date : null;
    const periodDays = periodType === 'CUSTOM' ? body.period_days ?? budget.period_days : null;
    if (periodType === 'CUSTOM' && (!startDate || !periodDays)) {
      return HttpResponse.json({ error: { code: 'CUSTOM_PERIOD_REQUIRED', message: 'Indica fecha de inicio y días.' } }, { status: 422 });
    }
    if (periodType === 'CUSTOM' && (!Number.isInteger(periodDays) || Number(periodDays) < 1 || Number(periodDays) > 366)) {
      return HttpResponse.json({ error: { code: 'INVALID_PERIOD_DAYS', message: 'Los días deben estar entre 1 y 366.' } }, { status: 422 });
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
    return HttpResponse.json(budget);
  }),
  http.delete('*/api/v1/budgets/:budgetId', ({ params, request }) => {
    if (!hasSession(request)) return sessionExpired();
    const budget = findBudget(String(params.budgetId));
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontramos este presupuesto.' } }, { status: 404 });
    budget.status = 'INACTIVE';
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/wallets', ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    return HttpResponse.json({ data: savedWallets });
  }),
  http.post('*/api/v1/wallets', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const body = await request.json() as Partial<CreateWalletPayload>;
    const name = body.name?.trim() ?? '';
    if (!name) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_EMPTY', message: 'El nombre del monedero no puede estar vacío. Por favor, escoja un nombre apropiado.' } },
        { status: 422 },
      );
    }
    if (name.length > 40) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_TOO_LONG', message: 'El nombre debe tener 40 caracteres o menos.' } },
        { status: 422 },
      );
    }
    if ((body.type !== 'bank' && body.type !== 'cash') || body.currency !== 'PEN') {
      return HttpResponse.json(
        { error: { code: 'INVALID_WALLET_DATA', message: 'Selecciona un tipo de monedero y una moneda disponibles.' } },
        { status: 422 },
      );
    }
    if (hasDuplicateWalletName(name)) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_DUPLICATED', message: 'El nombre del monedero ya está en uso. Por favor, escoja un nombre distinto.' } },
        { status: 409 },
      );
    }
    const initialBalance = body.initial_balance ?? '0.00';
    const balanceIsValid = typeof initialBalance === 'string'
      && /^\d{1,8}(?:\.\d{1,2})?$/.test(initialBalance)
      && BigInt(initialBalance.split('.')[0] ?? '0') <= 99_999_999n;
    if (!balanceIsValid) {
      return HttpResponse.json(
        { error: { code: 'INVALID_INITIAL_BALANCE', message: 'El saldo inicial debe ser un monto válido mayor o igual a S/ 0.00.' } },
        { status: 422 },
      );
    }

    const wallet: Wallet = {
      id: crypto.randomUUID(),
      name,
      type: body.type,
      currency: body.currency,
      initial_balance: initialBalance,
      balance: initialBalance,
      is_default: savedWallets.length === 0,
    };
    savedWallets.push(wallet);
    return HttpResponse.json({
      wallet,
      confirmation_message: `Monedero “${wallet.name}” creado con saldo inicial de S/ ${wallet.initial_balance}.`,
    }, { status: 201 });
  }),
  http.post('*/api/v1/categories/suggest', async ({ request }) => {
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
  http.post('*/extractions/text', async ({ request }) => {
    const body = await request.json() as { text?: string; wallet_id?: string };
    const text = body.text?.trim() ?? '';
    const amountMatch = text.match(/\d+(?:[.,]\d{1,2})?/);
    if (!amountMatch) {
      return HttpResponse.json({ error: { code: 'AMOUNT_NOT_FOUND', message: 'No se encontró un monto.' } }, { status: 422 });
    }

    const amount = amountMatch[0].replace(',', '.');
    const [whole, fraction = ''] = amount.split('.');
    const normalizedAmount = `${whole}.${fraction.padEnd(2, '0')}`;
    const type: TransactionType = /pagaron|ingreso|recib[ií]|sueldo|freelance|vend[ií]/i.test(text) ? 'INCOME' : 'EXPENSE';
    const concept = /^\s*\d+(?:[.,]\d{1,2})?\s*$/.test(text)
      ? 'Gasto general'
      : text.match(/(?:en|por|de)\s+(.+)$/i)?.[1]?.trim() || text.replace(amountMatch[0], '').trim() || 'Sin concepto';
    const category = findSuggestedCategory(type, concept);

    return HttpResponse.json({
      transaction: {
        id: crypto.randomUUID(),
        type,
        amount: normalizedAmount,
        currency: 'PEN',
        concept,
        transaction_date: today(),
        wallet_id: body.wallet_id ?? '4d6b3036-4290-4bde-aea4-375c779ef48b',
        category,
      },
    });
  }),
  http.post('*/transactions', async ({ request }) => {
    if (!hasSession(request)) return sessionExpired();
    const body = await request.json() as {
      type: TransactionType;
      amount: string;
      currency: string;
      concept: string;
      transaction_date: string;
      wallet_id: string;
      category_id: string;
      original_text?: string;
    };
    if (typeof body.amount !== 'string' || !isValidBudgetAmount(body.amount)) {
      return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un monto válido mayor que cero.' } }, { status: 422 });
    }
    if (body.currency !== 'PEN' && body.currency !== 'USD') {
      return HttpResponse.json({ error: { code: 'INVALID_CURRENCY', message: 'Selecciona una moneda válida.' } }, { status: 422 });
    }
    const category = categoryCatalog.find(({ id, type }) => id === body.category_id && type === body.type);
    if (!category) {
      return HttpResponse.json({ error: { code: 'INVALID_CATEGORY', message: 'La categoría seleccionada no es válida.' } }, { status: 422 });
    }

    const transaction: MockTransaction = {
      id: crypto.randomUUID(),
      type: body.type,
      amount: body.amount,
      currency: body.currency,
      concept: body.concept,
      transaction_date: body.transaction_date,
      wallet_id: body.wallet_id,
      category,
      source: 'TEXT',
    };
    savedTransactions.set(transaction.id, transaction);
    const alerts = body.type === 'EXPENSE'
      ? evaluateMockBudgetAlerts({
        categoryId: category.id,
        currency: body.currency,
        amountCents: amountToCents(body.amount),
        transactionDate: body.transaction_date || today(),
      })
      : [];

    return HttpResponse.json({ transaction, alerts }, { status: 201 });
  }),
  http.patch('*/transactions/:id', async ({ params, request }) => {
    const transactionId = String(params.id);
    const existingTransaction = savedTransactions.get(transactionId);
    if (!existingTransaction) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró la transacción.' } }, { status: 404 });
    }

    const body = await request.json() as { category_id?: string; concept?: string };
    const category = categoryCatalog.find(({ id, type }) => id === body.category_id && type === existingTransaction.type);
    if (body.category_id && !category) {
      return HttpResponse.json({ error: { code: 'INVALID_CATEGORY', message: 'La categoría seleccionada no es válida.' } }, { status: 422 });
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
      return HttpResponse.json({ error: { code: 'AUDIO_UNINTELLIGIBLE', message: 'No pude entender el audio. ¿Puedes repetirlo o escribirlo?' } }, { status: 422 });
    }
    if (audio.name.toLowerCase().includes('falla')) {
      return HttpResponse.json({ error: { code: 'STT_UNAVAILABLE', message: 'El servicio de voz no está disponible. Intenta más tarde.' } }, { status: 503 });
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
    };
    savedTransactions.set(transaction.id, transaction);
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
      return HttpResponse.json({ error: { code: 'IMAGE_INVALID', message: 'Selecciona una imagen JPG o PNG.' } }, { status: 422 });
    }
    if (image.name.toLowerCase().includes('falla')) {
      return HttpResponse.json({ error: { code: 'OCR_UNAVAILABLE', message: 'El servicio de lectura de imágenes no está disponible. Ingresa los datos manualmente.' } }, { status: 503 });
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
    };
    savedTransactions.set(transaction.id, transaction);
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
  http.post('*/auth/login', async ({ request }) => {
    const body = await request.json() as { email?: string; password?: string };
    if (body.email !== 'demo@test.com' || body.password !== '123456') {
      return HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos. Inténtalo de nuevo.' } }, { status: 401 });
    }

    return HttpResponse.json({
      access_token: 'fake-jwt-token',
      token_type: 'bearer',
      expires_in: 1200,
      user: {
        id: '6a2e2604-2fac-4d0e-b4c3-71cd82b85d80',
        name: 'Andrea',
        surname: 'Quispe',
        email: body.email,
        created_at: '2026-10-27T10:00:00Z',
      },
    });
  }),
];

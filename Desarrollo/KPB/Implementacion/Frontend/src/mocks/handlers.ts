import { http, HttpResponse } from 'msw';

const budgetCategories = [
  { id: 'cat-food', name: 'Alimentación', currency: 'PEN', type: 'EXPENSE' },
  { id: 'cat-transport', name: 'Transporte', currency: 'PEN', type: 'EXPENSE' },
  { id: 'cat-other', name: 'Otros', currency: 'PEN', type: 'EXPENSE' },
];

type MockBudget = {
  category_id: string;
  category_name: string;
  currency: string;
  monthly_limit: string | null;
  spent: string;
  usage_percentage: number;
  alert_threshold: number;
};

const mockBudgets: MockBudget[] = [
  { category_id: 'cat-food', category_name: 'Alimentación', currency: 'PEN', monthly_limit: '500.00', spent: '410.80', usage_percentage: 82.16, alert_threshold: 80 },
  { category_id: 'cat-transport', category_name: 'Transporte', currency: 'PEN', monthly_limit: '80.00', spent: '69.80', usage_percentage: 87.25, alert_threshold: 80 },
  { category_id: 'cat-other', category_name: 'Otros', currency: 'PEN', monthly_limit: null, spent: '0.00', usage_percentage: 0, alert_threshold: 80 },
];

function decimalToCents(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/api/v1/categories', () => HttpResponse.json({ data: budgetCategories })),
  http.get('*/api/v1/budgets', () => HttpResponse.json({ period: 'Setiembre 2026', data: mockBudgets })),
  http.put('*/api/v1/budgets/:categoryId', async ({ params, request }) => {
    const categoryId = String(params.categoryId);
    const body = await request.json() as { monthly_limit?: string };
    const budget = mockBudgets.find((item) => item.category_id === categoryId);
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró el presupuesto.' } }, { status: 404 });
    if (!body.monthly_limit) return HttpResponse.json({ error: { code: 'INVALID_AMOUNT', message: 'Ingresa un tope válido.' } }, { status: 422 });
    budget.monthly_limit = body.monthly_limit;
    const limitCents = decimalToCents(body.monthly_limit);
    const spentCents = decimalToCents(budget.spent);
    budget.usage_percentage = Number(spentCents * 10_000n / limitCents) / 100;
    return HttpResponse.json(budget);
  }),
  http.post('*/transactions/text', async ({ request }) => {
    const body = await request.json() as { text?: string };
    const text = body.text ?? '';
    if (/falla/i.test(text)) {
      return HttpResponse.json({
        error: { code: 'NLP_UNAVAILABLE', message: 'El servicio no está disponible. Por favor intente nuevamente.' },
      }, { status: 503 });
    }
    if (!body.text?.match(/\d/)) {
      return HttpResponse.json({ error: { code: 'AMOUNT_NOT_FOUND', message: 'No se encontró un monto.' } }, { status: 422 });
    }

    const amountMatch = text.match(/\d+(?:[.,]\d{1,2})?/);
    const rawAmount = amountMatch?.[0].replace(',', '.') ?? '15';
    const [wholeAmount, decimalAmount = ''] = rawAmount.split('.');
    const amount = `${wholeAmount}.${decimalAmount.padEnd(2, '0')}`;
    const isExceeded = /excedido/i.test(text);
    const hasAlert = /alerta/i.test(text);
    const botMood = isExceeded ? 'sad' : hasAlert ? 'surprised' : 'happy';
    const alert = isExceeded
      ? { message: 'Excediste el tope de Alimentación.', severity: 'danger' }
      : hasAlert
        ? { message: 'Alcanzaste el 80% de tu presupuesto de Alimentación.', severity: 'warning' }
        : undefined;
    const isMenu = /men[uú]|pan/i.test(text);
    return HttpResponse.json({
      botMood,
      transaction: {
        id: '8c9c1af0-4ca8-4fc4-8c90-d87bc00f4345',
        type: /pagaron|ingreso|recib[ií]/i.test(text) ? 'INCOME' : 'EXPENSE',
        amount,
        currency: 'PEN',
        concept: isMenu ? 'Menú' : 'Sin concepto',
        transaction_date: new Date().toISOString().slice(0, 10),
        wallet_id: '4d6b3036-4290-4bde-aea4-375c779ef48b',
        category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: isMenu ? 'Alimentación' : 'Otros', icon: isMenu ? 'utensils' : 'shapes' },
        source: 'TEXT',
        category_confidence: isMenu ? 0.94 : 0.5,
        needs_review: !isMenu,
      },
      wallet_balance: '185.00',
      alerts: alert ? [alert] : [],
      message: isExceeded
        ? 'Excediste el tope de Alimentación.'
        : `Registré S/ ${amount} en ${isMenu ? 'Alimentación' : 'Otros'}. Si algo no está bien, puedes corregirlo.`,
      wallet_name: 'BCP',
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

type MockNotification = {
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

const thresholdConfigs = new Map(mockBudgets.filter((budget) => budget.monthly_limit !== null).map((budget) => [budget.category_id, {
  thresholds: [budget.alert_threshold], channels: ['app'], is_default: true,
}]));
const mockStartedAt = Date.now();
let liveNotificationAdded = false;
const mockNotifications: MockNotification[] = [
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

handlers.unshift(
  http.get('*/api/v1/budgets/:categoryId/alert-thresholds', ({ params }) => {
    const categoryId = String(params.categoryId);
    const config = thresholdConfigs.get(categoryId);
    if (!config) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró el presupuesto.' } }, { status: 404 });
    return HttpResponse.json({ category_id: categoryId, ...config });
  }),
  http.put('*/api/v1/budgets/:categoryId/alert-thresholds', async ({ params, request }) => {
    const categoryId = String(params.categoryId);
    if (!mockBudgets.some((budget) => budget.category_id === categoryId && budget.monthly_limit !== null)) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró el presupuesto.' } }, { status: 404 });
    }
    const body = await request.json() as { thresholds?: number[]; channels?: string[] };
    const thresholds = body.thresholds;
    if (!thresholds || thresholds.length < 1 || thresholds.length > 5 || thresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100) || new Set(thresholds).size !== thresholds.length) {
      return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'Configura entre uno y cinco porcentajes enteros del 1 al 100.' } }, { status: 422 });
    }
    const channels = body.channels ?? ['app'];
    if (channels.some((channel) => !['app', 'email'].includes(channel))) {
      return HttpResponse.json({ error: { code: 'INVALID_CHANNEL', message: 'Selecciona canales válidos.' } }, { status: 422 });
    }
    const config = { thresholds, channels, is_default: false };
    thresholdConfigs.set(categoryId, config);
    const budget = mockBudgets.find((item) => item.category_id === categoryId);
    if (budget) budget.alert_threshold = thresholds[0] ?? budget.alert_threshold;
    return HttpResponse.json({ category_id: categoryId, ...config });
  }),
  http.get('*/api/v1/notifications', ({ request }) => {
    if (!liveNotificationAdded && Date.now() - mockStartedAt >= 10_000) {
      liveNotificationAdded = true;
      mockNotifications.unshift({
        id: 'notif-live-food-90', type: 'budget_alert', priority: 'normal',
        category: { id: 'cat-food', name: 'Alimentación' }, threshold_percentage: 90,
        usage_percentage: 91.2, spent_month: '456.00', monthly_limit: '500.00', remaining: '44.00',
        message: 'Llegaste al 90% de tu tope en Alimentación. Gastaste S/ 456.00 de S/ 500.00.',
        read: false, created_at: new Date().toISOString(),
      });
    }
    const params = new URL(request.url).searchParams;
    const type = params.get('type');
    const unread = params.get('unread');
    const page = Math.max(1, Number(params.get('page') ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(params.get('page_size') ?? 10)));
    const filtered = mockNotifications.filter((item) => (!type || item.type === type) && (unread === null || item.read === (unread !== 'true')));
    const offset = (page - 1) * pageSize;
    return HttpResponse.json({
      data: filtered.slice(offset, offset + pageSize),
      pagination: { page, page_size: pageSize, total: filtered.length, pages: Math.ceil(filtered.length / pageSize) },
    });
  }),
  http.patch('*/api/v1/notifications/:notificationId/read', ({ params }) => {
    const notification = mockNotifications.find((item) => item.id === String(params.notificationId));
    if (!notification) return new HttpResponse(null, { status: 404 });
    notification.read = true;
    return new HttpResponse(null, { status: 204 });
  }),
);

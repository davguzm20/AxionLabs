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
  http.put('*/api/v1/budgets/:categoryId/alert-thresholds', async ({ params, request }) => {
    const categoryId = String(params.categoryId);
    const budget = mockBudgets.find((item) => item.category_id === categoryId);
    const body = await request.json() as { thresholds?: number[] };
    if (!budget) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró el presupuesto.' } }, { status: 404 });
    const threshold = body.thresholds?.[0];
    if (!threshold || threshold < 1 || threshold > 100) return HttpResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'El porcentaje debe estar entre 1 y 100.' } }, { status: 422 });
    budget.alert_threshold = threshold;
    return HttpResponse.json({ thresholds: [threshold] });
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

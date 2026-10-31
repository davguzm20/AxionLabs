import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/api/v1/categories', () => HttpResponse.json([
    { id: 'category-food', name: 'Alimentación', type: 'EXPENSE', icon: 'utensils' },
    { id: 'category-transport', name: 'Transporte', type: 'EXPENSE', icon: 'bus' },
    { id: 'category-health', name: 'Salud', type: 'EXPENSE', icon: 'heart-pulse' },
    { id: 'category-other', name: 'Otros', type: 'EXPENSE', icon: 'circle-help' },
  ])),
  http.post('*/api/v1/categories/suggest', async ({ request }) => {
    const body = await request.json() as { concept?: string; amount?: string };
    const concept = body.concept?.toLocaleLowerCase('es-PE') ?? '';
    const isFood = /café|cafe|almuerzo|comida/.test(concept);
    const category = isFood
      ? { id: 'category-food', name: 'Alimentación', type: 'EXPENSE', icon: 'utensils' }
      : { id: 'category-other', name: 'Otros', type: 'EXPENSE', icon: 'circle-help' };

    return HttpResponse.json({
      category,
      confidence: isFood ? 0.94 : 0.3,
      reason: isFood ? 'El concepto se relaciona con alimentación.' : 'No se encontró una coincidencia clara.',
      needs_review: !isFood,
    });
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

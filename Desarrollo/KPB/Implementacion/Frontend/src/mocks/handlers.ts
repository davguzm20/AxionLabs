import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/categories', () => HttpResponse.json({
    data: [
      { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'EXPENSE', icon: 'utensils', status: 'ACTIVE' },
      { id: 'c815c08e-0300-4c4a-a4f0-9d6747347f09', name: 'Transporte', type: 'EXPENSE', icon: 'car', status: 'ACTIVE' },
      { id: 'd7a27763-e456-483f-8853-1506421e21db', name: 'Otros', type: 'EXPENSE', icon: 'shapes', status: 'ACTIVE' },
      { id: 'fb9babf0-b268-4bde-9dc5-7f8953012bc6', name: 'Ingresos', type: 'INCOME', icon: 'briefcase', status: 'ACTIVE' },
    ],
  })),
  http.get('*/wallets', () => HttpResponse.json({
    data: [{
      id: '4d6b3036-4290-4bde-aea4-375c779ef48b',
      name: 'BCP',
      currency: 'PEN',
      is_default: true,
      status: 'ACTIVE',
    }],
  })),
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
  http.post('*/transactions/voice', async ({ request }) => {
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
        transaction_date: '2026-10-30',
        wallet_id: '4d6b3036-4290-4bde-aea4-375c779ef48b',
        category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', icon: 'utensils', type: 'EXPENSE' },
      },
      confidence: 0.92,
      requires_confirmation: true,
    }, { status: 200 });
  }),
  http.post('*/transactions/voice/confirm', async ({ request }) => {
    const body = await request.json() as {
      type: 'EXPENSE' | 'INCOME';
      amount: string;
      currency: string;
      concept: string;
      transaction_date: string;
      category_id: string;
      wallet_id: string;
    };
    const categoryName = body.category_id === 'f61d5fcc-730a-48d9-81dc-1db75ce4af16'
      ? 'Alimentación'
      : body.category_id === 'c815c08e-0300-4c4a-a4f0-9d6747347f09'
        ? 'Transporte'
        : body.type === 'INCOME' ? 'Ingresos' : 'Otros';
    return HttpResponse.json({
      transaction: {
        id: 'voice-transaction-20261030-001',
        type: body.type,
        amount: body.amount,
        currency: body.currency,
        concept: body.concept,
        transaction_date: body.transaction_date,
        wallet_id: body.wallet_id,
        category: { id: body.category_id, name: categoryName, icon: 'circle-help', type: body.type },
      },
      wallet_name: 'BCP',
      wallet_balance: '170.00',
      alerts: [],
    }, { status: 201 });
  }),
  http.post('*/transactions/receipt', async ({ request }) => {
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
        transaction_date: '2026-10-31',
        wallet_id: '4d6b3036-4290-4bde-aea4-375c779ef48b',
        category: { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', icon: 'utensils', type: 'EXPENSE' },
      },
      confidence: 0.88,
      requires_confirmation: true,
    }, { status: 200 });
  }),
  http.post('*/transactions/receipt/confirm', async ({ request }) => {
    const body = await request.json() as {
      type: 'EXPENSE' | 'INCOME';
      amount: string;
      currency: string;
      concept: string;
      transaction_date: string;
      category_id: string;
      wallet_id: string;
    };
    const categoryName = body.category_id === 'f61d5fcc-730a-48d9-81dc-1db75ce4af16'
      ? 'Alimentación'
      : body.category_id === 'c815c08e-0300-4c4a-a4f0-9d6747347f09'
        ? 'Transporte'
        : body.type === 'INCOME' ? 'Ingresos' : 'Otros';
    return HttpResponse.json({
      transaction: {
        id: 'receipt-transaction-20261031-001',
        type: body.type,
        amount: body.amount,
        currency: body.currency,
        concept: body.concept,
        transaction_date: body.transaction_date,
        wallet_id: body.wallet_id,
        category: { id: body.category_id, name: categoryName, icon: 'circle-help', type: body.type },
      },
      wallet_name: 'BCP',
      wallet_balance: '124.10',
      alerts: [],
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

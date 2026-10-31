import { http, HttpResponse } from 'msw';
import type { Wallet } from '../features/wallets/types/wallet.types';

type TransactionType = 'EXPENSE' | 'INCOME';
type MockCategory = { id: string; name: string; type: TransactionType; icon: string; source?: string };
type MockTransaction = {
  id: string;
  type: TransactionType;
  amount: string;
  currency: string;
  concept: string;
  transaction_date: string;
  wallet_id: string;
  category: MockCategory;
  source: 'TEXT' | 'MANUAL';
};

const categoryCatalog: MockCategory[] = [
  { id: 'category-food', name: 'Alimentación', type: 'EXPENSE', icon: 'utensils' },
  { id: 'category-transport', name: 'Transporte', type: 'EXPENSE', icon: 'bus' },
  { id: 'category-health', name: 'Salud', type: 'EXPENSE', icon: 'heart-pulse' },
  { id: 'category-other', name: 'Otros', type: 'EXPENSE', icon: 'circle-help' },
  { id: 'category-salary', name: 'Sueldo', type: 'INCOME', icon: 'wallet' },
  { id: 'category-freelance', name: 'Freelance', type: 'INCOME', icon: 'laptop' },
  { id: 'category-sales', name: 'Ventas', type: 'INCOME', icon: 'store' },
  { id: 'category-other-income', name: 'Otros', type: 'INCOME', icon: 'circle-help' },
  { id: 'f61d5fcc-730a-48d9-81dc-1db75ce4af16', name: 'Alimentación', type: 'EXPENSE', icon: 'utensils' },
];

const savedTransactions = new Map<string, MockTransaction>();
const savedWallets: Wallet[] = [
  {
    id: 'wallet-cash-default',
    name: 'Efectivo',
    type: 'cash',
    currency: 'PEN',
    balance: '150.00',
    is_default: true,
  },
];
const today = () => new Date().toISOString().slice(0, 10);

function hasDuplicateWalletName(name: string, excludeId?: string): boolean {
  const normalizedName = name.trim().toLocaleLowerCase('es-PE');
  return savedWallets.some((wallet) => wallet.id !== excludeId && wallet.name.trim().toLocaleLowerCase('es-PE') === normalizedName);
}

function amountToCents(amount: string): bigint {
  const [whole = '0', fraction = '00'] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

function findSuggestedCategory(type: TransactionType, concept: string): MockCategory {
  const normalized = concept.toLocaleLowerCase('es-PE');
  const patterns = type === 'INCOME'
    ? [[/sueldo|salario|planilla/, 'category-salary'], [/freelance|servicio/, 'category-freelance'], [/venta|vend[ií]/, 'category-sales']]
    : [[/caf[eé]|almuerzo|cena|comida|men[uú]|restaurante/, 'category-food'], [/taxi|bus|pasaje|metro|transporte/, 'category-transport'], [/farmacia|doctor|salud|medicina/, 'category-health']];
  const matchedId = patterns.find(([pattern]) => (pattern as RegExp).test(normalized))?.[1] as string | undefined;
  const fallbackId = type === 'INCOME' ? 'category-other-income' : 'category-other';
  return categoryCatalog.find(({ id }) => id === (matchedId ?? fallbackId)) ?? categoryCatalog[0]!;
}

export const handlers = [
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/api/v1/wallets', () => HttpResponse.json({ data: savedWallets })),
  http.post('*/api/v1/wallets', async ({ request }) => {
    const body = await request.json() as Partial<Wallet>;
    const name = body.name?.trim() ?? '';
    if (hasDuplicateWalletName(name)) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_EXISTS', message: 'El nombre del monedero ya está en uso.' } },
        { status: 409 },
      );
    }

    const wallet: Wallet = {
      id: crypto.randomUUID(),
      name,
      type: body.type === 'bank' ? 'bank' : 'cash',
      currency: 'PEN',
      balance: body.balance ?? '0.00',
      is_default: savedWallets.length === 0,
    };
    savedWallets.push(wallet);
    return HttpResponse.json(wallet, { status: 201 });
  }),
  http.patch('*/api/v1/wallets/:id', async ({ params, request }) => {
    const walletId = String(params.id);
    const wallet = savedWallets.find((item) => item.id === walletId);
    if (!wallet) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'No se encontró el monedero.' } }, { status: 404 });
    }

    const body = await request.json() as { name?: string; balance?: string };
    const name = body.name?.trim() ?? wallet.name;
    if (hasDuplicateWalletName(name, walletId)) {
      return HttpResponse.json(
        { error: { code: 'WALLET_NAME_EXISTS', message: 'El nombre del monedero ya está en uso.' } },
        { status: 409 },
      );
    }

    Object.assign(wallet, { name, ...(body.balance !== undefined ? { balance: body.balance } : {}) });
    return HttpResponse.json(wallet);
  }),
  http.get('*/api/v1/categories', () => HttpResponse.json(categoryCatalog)),
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
    const originalText = body.original_text ?? body.concept;
    const isExceeded = /excedido/i.test(originalText);
    const amountInCents = amountToCents(body.amount);
    let budgetAlert: {
      priority: 'high' | 'normal';
      threshold_percentage: number;
      usage_percentage: number;
      message: string;
    } | null = null;
    if (amountInCents > 40000n || isExceeded) {
      budgetAlert = {
        priority: 'high',
        threshold_percentage: 100,
        usage_percentage: 105.0,
        message: `Superaste tu tope de S/ 500.00 en ${category.name}. Llevas gastado S/ 525.00.`,
      };
    } else if (amountInCents > 20000n || /alerta/i.test(originalText)) {
      budgetAlert = {
        priority: 'normal',
        threshold_percentage: 80,
        usage_percentage: 80.0,
        message: `Alcanzaste el 80% de tu presupuesto de ${category.name}.`,
      };
    }

    return HttpResponse.json({ transaction, budget_alert: budgetAlert }, { status: 201 });
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

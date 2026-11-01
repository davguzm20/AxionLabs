import type { Currency } from '../types/budget.types';

const MAX_AMOUNT_CENTS = 9_999_999_999n;
const MAX_INTEGER_DIGITS = 18;

export function parseMoneyToCents(value: string): bigint | null {
  const normalized = value.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match || (match[1]?.length ?? 0) > MAX_INTEGER_DIGITS) return null;

  const whole = BigInt(match[1] ?? '0');
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return whole * 100n + fraction;
}

export function normalizeMoney(value: string): string | null {
  const cents = parseMoneyToCents(value);
  if (cents === null || cents > MAX_AMOUNT_CENTS) return null;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function formatMoney(value: string, currency: Currency): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const absolute = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = absolute.split('.');
  const groupedWhole = new Intl.NumberFormat('es-PE', {
    maximumFractionDigits: 0,
  }).format(BigInt(whole || '0'));
  const symbol = currency === 'PEN' ? 'S/ ' : '$ ';

  return `${negative ? '-' : ''}${symbol}${groupedWhole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

export function calculatePercentage(consumed: string, amount: string): number {
  const consumedCents = parseMoneyToCents(consumed);
  const amountCents = parseMoneyToCents(amount);
  if (consumedCents === null || amountCents === null || amountCents === 0n) return 0;

  const tenthsOfPercent = (consumedCents * 1_000n) / amountCents;
  return Number(tenthsOfPercent) / 10;
}

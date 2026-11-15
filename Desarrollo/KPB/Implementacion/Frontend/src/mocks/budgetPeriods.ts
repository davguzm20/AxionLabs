import type { BudgetPeriodType } from '../features/budgets/types/budget.types';

const DAY = 86_400_000;

/** Los periodos financieros usan la fecha civil de Lima, no la zona del dispositivo. */
export function budgetToday(now = new Date()): string {
  return new Date(now.getTime() - 5 * 60 * 60_000).toISOString().slice(0, 10);
}

export function validBudgetDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function getCurrentBudgetPeriod(type: BudgetPeriodType, startDate: string | null, days: number | null) {
  const current = new Date(`${budgetToday()}T00:00:00Z`);
  let start = current.getTime();
  let end: number;
  if (type === 'MONTHLY') {
    start = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1);
    end = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0);
  } else if (type === 'WEEKLY') {
    start -= ((current.getUTCDay() + 6) % 7) * DAY;
    end = start + 6 * DAY;
  } else {
    const origin = Date.parse(`${startDate ?? budgetToday()}T00:00:00Z`);
    const length = (days ?? 1) * DAY;
    start = origin + Math.max(0, Math.floor((start - origin) / length)) * length;
    end = start + length - DAY;
  }
  return { period_start: new Date(start).toISOString().slice(0, 10), period_end: new Date(end).toISOString().slice(0, 10) };
}

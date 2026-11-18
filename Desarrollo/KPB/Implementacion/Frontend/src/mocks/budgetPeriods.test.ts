import { afterEach, describe, expect, it, vi } from 'vitest';
import { budgetToday, getCurrentBudgetPeriod, validBudgetDate } from './budgetPeriods';

afterEach(() => vi.useRealTimers());

describe('CU07 — periodos civiles de Lima', () => {
  it.each([
    ['2026-12-01T04:59:59Z', '2026-11-30', '2026-11-01', '2026-11-30'],
    ['2026-12-01T05:00:00Z', '2026-12-01', '2026-12-01', '2026-12-31'],
    ['2028-02-29T17:00:00Z', '2028-02-29', '2028-02-01', '2028-02-29'],
  ])('calcula el mes en %s', (now, date, start, end) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now));
    expect(budgetToday()).toBe(date);
    expect(getCurrentBudgetPeriod('MONTHLY', null, null)).toEqual({ period_start: start, period_end: end });
  });

  it.each([
    ['2026-11-16T04:59:59Z', '2026-11-09', '2026-11-15'],
    ['2026-11-16T05:00:00Z', '2026-11-16', '2026-11-22'],
  ])('reinicia el lunes de Lima en %s', (now, start, end) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now));
    expect(getCurrentBudgetPeriod('WEEKLY', null, null)).toEqual({ period_start: start, period_end: end });
  });

  it('repite el periodo personalizado y respeta una fecha de inicio futura', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T17:00:00Z'));
    expect(getCurrentBudgetPeriod('CUSTOM', '2026-11-14', 2)).toEqual({ period_start: '2026-11-16', period_end: '2026-11-17' });
    expect(getCurrentBudgetPeriod('CUSTOM', '2026-12-01', 3)).toEqual({ period_start: '2026-12-01', period_end: '2026-12-03' });
  });

  it.each(['2026-02-30', '2026-13-01', 'texto', '2026-1-1', ''])('rechaza la fecha inexistente %s', (date) => {
    expect(validBudgetDate(date)).toBe(false);
  });
});

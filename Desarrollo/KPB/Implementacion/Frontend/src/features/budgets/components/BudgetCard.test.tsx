import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BudgetCard } from './BudgetCard';

describe('BudgetCard', () => {
  it('muestra una categoría sin tope y permite establecerlo para esa categoría', async () => {
    const user = userEvent.setup();
    const category = {
      id: 'category-transporte',
      name: 'Transporte',
      icon: 'bus',
    };
    const onSetLimit = vi.fn();

    render(
      <BudgetCard
        budget={{
          id: null,
          category,
          currency: null,
          amount: null,
          period_type: null,
          start_date: null,
          period_days: null,
          period_start: null,
          period_end: null,
          consumed: null,
          remaining: null,
          monthly_consumed_by_currency: [
            { currency: 'PEN', amount: '42.50' },
            { currency: 'USD', amount: '6.25' },
          ],
          status: 'NONE',
          thresholds: [],
        }}
        onEdit={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onSetLimit={onSetLimit}
      />,
    );

    expect(screen.getByText('Sin tope configurado')).toBeInTheDocument();
    expect(screen.getByText('Gastado este mes')).toBeInTheDocument();
    expect(screen.getByText('S/ 42.50')).toBeInTheDocument();
    expect(screen.getByText('$ 6.25')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Establecer tope' }));
    expect(onSetLimit).toHaveBeenCalledWith(category);
  });

  it('indica cuando una categoría sin tope no tiene gastos en el mes', () => {
    render(
      <BudgetCard
        budget={{
          id: null,
          category: { id: 'category-salud', name: 'Salud', icon: 'heart' },
          currency: null,
          amount: null,
          period_type: null,
          start_date: null,
          period_days: null,
          period_start: null,
          period_end: null,
          consumed: null,
          remaining: null,
          monthly_consumed_by_currency: [],
          status: 'NONE',
          thresholds: [],
        }}
        onEdit={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onSetLimit={vi.fn()}
      />,
    );

    expect(screen.getByText('Sin gastos registrados')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

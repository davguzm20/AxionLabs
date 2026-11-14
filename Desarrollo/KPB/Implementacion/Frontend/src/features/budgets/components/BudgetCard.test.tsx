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
          percentage: 0,
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
    await user.click(screen.getByRole('button', { name: 'Establecer tope' }));
    expect(onSetLimit).toHaveBeenCalledWith(category);
  });
});

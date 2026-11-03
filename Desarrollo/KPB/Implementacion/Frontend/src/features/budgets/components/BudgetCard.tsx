import {
  BookOpen,
  BusFront,
  CircleHelp,
  Gamepad2,
  HeartPulse,
  House,
  Pencil,
  Power,
  ReceiptText,
  ShoppingBag,
  Utensils,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatMoney } from '../utils/money';
import type { Budget } from '../types/budget.types';

const categoryIcons: Record<string, LucideIcon> = {
  'alimentaci\u00f3n': Utensils,
  transporte: BusFront,
  salud: HeartPulse,
  hogar: House,
  servicios: ReceiptText,
  entretenimiento: Gamepad2,
  'educaci\u00f3n': BookOpen,
  compras: ShoppingBag,
  'salidas con amigos': Users,
};

interface BudgetCardProps {
  budget: Budget;
  onEdit: (budget: Budget) => void;
  onDeactivate: (budget: Budget) => void;
  onReactivate: (budget: Budget) => void;
  busy?: boolean;
}

function getProgressColor(percentage: number): string {
  if (percentage > 100) return 'bg-red-600';
  if (percentage >= 80) return 'bg-yellow-500';
  return 'bg-teal-600';
}

export function BudgetCard({ budget, onEdit, onDeactivate, onReactivate, busy = false }: BudgetCardProps) {
  const categoryName = budget.category.name;
  const Icon = categoryIcons[categoryName.toLocaleLowerCase('es-PE')] ?? CircleHelp;
  const percentage = Math.max(0, budget.percentage);
  const isInactive = budget.status === 'INACTIVE';
  const exceeded = percentage > 100;
  const amountOverLimit = budget.remaining.startsWith('-') ? budget.remaining.slice(1) : budget.remaining;
  const remainingColor = exceeded ? 'font-medium text-red-600' : 'text-gray-600';

  return (
    <article aria-labelledby={`budget-${budget.id}-title`} className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center">
          <Icon aria-hidden="true" size={18} className="shrink-0 text-gray-700" />
          <h2 id={`budget-${budget.id}-title`} className="ml-2 min-w-0 truncate text-base font-semibold text-gray-900">{categoryName}</h2>
        </div>
        <div className="flex shrink-0 items-center">
          {!isInactive && (
            <>
              <button type="button" aria-label={`Editar presupuesto de ${categoryName}`} title="Editar presupuesto" onClick={() => onEdit(budget)} className="ml-3 flex size-10 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                <Pencil aria-hidden="true" size={18} />
              </button>
              <button type="button" aria-label={`Desactivar presupuesto de ${categoryName}`} title="Desactivar presupuesto" onClick={() => onDeactivate(budget)} disabled={busy} className="flex size-10 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-50">
                <Power aria-hidden="true" size={18} />
              </button>
            </>
          )}
          {isInactive && (
            <button type="button" aria-label={`Reactivar presupuesto de ${categoryName}`} title="Reactivar presupuesto" onClick={() => onReactivate(budget)} disabled={busy} className="ml-3 flex size-10 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50">
              <Power aria-hidden="true" size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="mb-2 mt-1 flex items-center justify-between gap-3">
        <p className={`min-w-0 truncate text-sm ${remainingColor}`}>
          {exceeded
            ? `Te pasaste por ${formatMoney(amountOverLimit, budget.currency)}`
            : `Te quedan ${formatMoney(budget.remaining, budget.currency)}`}
        </p>
        <span className={`shrink-0 whitespace-nowrap text-sm font-medium ${exceeded ? 'text-red-600' : 'text-gray-500'}`}>
          {percentage.toFixed(0)}%
        </span>
      </div>

      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label={`Uso del presupuesto de ${categoryName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(percentage, 100)} aria-valuetext={`${percentage.toFixed(0)}% utilizado${exceeded ? ', presupuesto excedido' : ''}`}>
        <div className={`h-2 rounded-full ${getProgressColor(percentage)}`} style={{ width: `${Math.min(percentage, 100)}%` }} />
      </div>

      <div className="mt-2 flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">Gastado:</p>
          <p className="truncate text-sm font-semibold text-gray-900" title={formatMoney(budget.consumed, budget.currency)}>{formatMoney(budget.consumed, budget.currency)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-gray-500">Tope:</p>
          <p className={`whitespace-nowrap text-sm font-semibold ${exceeded ? 'text-red-600' : 'text-gray-900'}`} title={formatMoney(budget.amount, budget.currency)}>
            {formatMoney(budget.amount, budget.currency)}
          </p>
        </div>
      </div>
    </article>
  );
}

import {
  BookOpen,
  BusFront,
  CircleHelp,
  Gamepad2,
  HeartPulse,
  House,
  Pencil,
  ReceiptText,
  ShoppingBag,
  Utensils,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatMoney } from '../utils/money';
import type { Budget } from '../types/budget.types';

const categoryIcons: Record<string, LucideIcon> = {
  alimentación: Utensils,
  transporte: BusFront,
  salud: HeartPulse,
  hogar: House,
  servicios: ReceiptText,
  entretenimiento: Gamepad2,
  educación: BookOpen,
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

function getPeriodName(budget: Budget): string {
  if (budget.period_type === 'WEEKLY') return 'Semanal';
  if (budget.period_type === 'MONTHLY') return 'Mensual';
  return `Cada ${budget.period_days ?? 0} días`;
}

function getRestartLabel(periodEnd: string): string {
  const [year = 1970, month = 1, day = 1] = periodEnd.split('-').map(Number);
  const nextPeriod = new Date(year, month - 1, day + 1, 12);
  const date = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
  }).format(nextPeriod);

  return `Se reinicia el ${date}`;
}

function getProgressState(percentage: number): { label: string; color: string } {
  if (percentage >= 100) return { label: 'Te pasaste', color: 'bg-danger-600' };
  if (percentage >= 80) return { label: 'Estás cerca del tope', color: 'bg-warning-500' };
  return { label: 'Vas bien', color: 'bg-brand-500' };
}

export function BudgetCard({ budget, onEdit, onDeactivate, onReactivate, busy = false }: BudgetCardProps) {
  const Icon = categoryIcons[budget.category.name.toLocaleLowerCase('es-PE')] ?? CircleHelp;
  const percentage = Math.max(0, budget.percentage);
  const state = getProgressState(percentage);
  const isInactive = budget.status === 'INACTIVE';
  const negativeRemaining = budget.remaining.startsWith('-');
  const remainingAmount = negativeRemaining ? budget.remaining.slice(1) : budget.remaining;
  const triggeredThresholds = budget.thresholds.filter((threshold) => threshold.triggered);

  return (
    <article aria-labelledby={`budget-${budget.id}-title`} className="rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon aria-hidden="true" size={20} className="shrink-0 text-ink-700" />
          <div className="min-w-0">
            <h2 id={`budget-${budget.id}-title`} className="truncate text-base font-semibold text-ink-900">
              {budget.category.name}
            </h2>
            <p className="text-xs text-ink-500">{getPeriodName(budget)} · {budget.currency}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isInactive && (
            <>
              <button
                type="button"
                aria-label={`Editar presupuesto de ${budget.category.name}`}
                onClick={() => onEdit(budget)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-accent-600 hover:bg-accent-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
              >
                <Pencil aria-hidden="true" size={19} />
              </button>
              <button
                type="button"
                aria-label={`Desactivar presupuesto de ${budget.category.name}`}
                onClick={() => onDeactivate(budget)}
                disabled={busy}
                className="min-h-11 rounded-md px-2 text-xs font-medium text-ink-500 underline hover:text-danger-600 disabled:opacity-50"
              >
                Desactivar
              </button>
            </>
          )}
          {isInactive && (
            <button
              type="button"
              onClick={() => onReactivate(budget)}
              disabled={busy}
              className="min-h-11 rounded-md px-2 text-sm font-medium text-accent-600 underline disabled:opacity-50"
            >
              Reactivar
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`text-sm font-medium ${percentage >= 100 ? 'text-danger-600' : percentage >= 80 ? 'text-ink-700' : 'text-ink-500'}`}>
          {percentage.toFixed(1)}% · {state.label}
        </p>
        {isInactive && <span className="rounded-full bg-bg px-2.5 py-1 text-xs font-medium text-ink-700">Inactivo</span>}
      </div>

      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-ink-300/50"
        role="progressbar"
        aria-label={`Uso del presupuesto de ${budget.category.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percentage, 100)}
        aria-valuetext={`${percentage.toFixed(1)}% utilizado. ${state.label}.`}
      >
        <div className={`h-full rounded-full ${state.color}`} style={{ width: `${Math.min(percentage, 100)}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <p className="text-ink-700">Gastado: {formatMoney(budget.consumed, budget.currency)}</p>
        <p className="font-semibold text-ink-700">Tope: {formatMoney(budget.amount, budget.currency)}</p>
      </div>
      <p className={`mt-1 text-sm ${negativeRemaining ? 'font-medium text-danger-600' : 'text-ink-700'}`}>
        {negativeRemaining
          ? `Te pasaste por ${formatMoney(remainingAmount, budget.currency)}`
          : `Disponible: ${formatMoney(budget.remaining, budget.currency)}`}
      </p>
      <p className="mt-1 text-xs text-ink-500">{getRestartLabel(budget.period_end)}</p>

      {triggeredThresholds.length > 0 && (
        <p className="mt-2 text-xs font-medium text-warning-600">
          Aviso alcanzado: {triggeredThresholds.map(({ percentage: value }) => `${value}%`).join(', ')}
        </p>
      )}
    </article>
  );
}

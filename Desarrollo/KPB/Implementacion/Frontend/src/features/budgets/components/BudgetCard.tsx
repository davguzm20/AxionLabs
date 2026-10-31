
import {
  CarFront,
  CircleHelp,
  HeartPulse,
  Pencil,
  Utensils,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Budget } from '../types/budget.types';

const categoryIcons: Record<string, LucideIcon> = {
  alimentación: Utensils,
  transporte: CarFront,
  salud: HeartPulse,
};

interface BudgetCardProps {
  budget: Budget;
  onEdit: (budget: Budget) => void;
}

function toCents(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

function fromCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;

  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, '0')}`;
}

export function BudgetCard({ budget, onEdit }: BudgetCardProps) {
  const Icon =
    categoryIcons[budget.category_name.toLocaleLowerCase('es-PE')] ??
    CircleHelp;

  const percentage = Math.max(0, budget.usage_percentage);

  const progressColor =
    percentage > 100
      ? 'bg-red-600'
      : percentage > 80
        ? 'bg-yellow-500'
        : 'bg-brand-600';

  const remaining = budget.monthly_limit
    ? fromCents(
      toCents(budget.monthly_limit) - toCents(budget.spent)
    )
    : null;

  return (
    <article className="mb-4 rounded-xl border border-ink-300 bg-white p-5 shadow-sm">

      {/* Encabezado: icono y categoría */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon
            aria-hidden="true"
            size={22}
            strokeWidth={1.8}
            className="shrink-0 text-gray-500"
          />

          <h2 className="truncate text-base font-semibold text-gray-900">
            {budget.category_name}
          </h2>
        </div>

        {/* Botón editar */}
        <button
          type="button"
          aria-label={`Editar presupuesto de ${budget.category_name}`}
          onClick={() => onEdit(budget)}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-teal-600 transition-colors hover:bg-teal-50"
        >
          <Pencil aria-hidden="true" size={18} />
        </button>
      </div>

      {/* Barra de progreso */}
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-label={`Uso del presupuesto de ${budget.category_name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percentage, 100)}
      >
        <div
          className={`h-full ${progressColor}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      <p className="mt-2 text-xs font-medium text-ink-500">
        {budget.usage_percentage.toFixed(1)}% utilizado
      </p>

      {/* Gastado y tope */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <p>
          <span className="text-xs font-medium text-gray-500">
            Gastado:
          </span>
          <br />
          <span className="text-lg font-bold tabular-nums text-ink-900">
            S/ {budget.spent}
          </span>
        </p>

        <p className="text-right">
          <span className="text-xs font-medium text-gray-500">
            Tope:
          </span>
          <br />
          <span className="text-lg font-bold tabular-nums text-ink-900">
            {budget.monthly_limit
              ? `S/ ${budget.monthly_limit}`
              : 'Sin tope'}
          </span>
        </p>
      </div>

      {/* Dinero disponible o excedido */}
      {remaining !== null && (
        <p
          className={`mt-3 text-sm font-medium ${remaining.startsWith('-')
            ? 'text-red-600'
            : 'text-gray-500'
            }`}
        >
          {remaining.startsWith('-')
            ? `Excedido: S/ ${remaining.slice(1)}`
            : `Disponible: S/ ${remaining}`}
        </p>
      )}
    </article>
  );
}

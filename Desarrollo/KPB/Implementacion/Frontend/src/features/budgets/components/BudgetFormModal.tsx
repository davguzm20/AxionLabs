import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, X } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { Budget, Category } from '../types/budget.types';

const schema = z.object({
  category_id: z.string().min(1, 'Selecciona una categoría.'),
  monthly_limit: z.string().regex(/^\d+(?:\.\d{1,2})?$/, 'Ingresa un monto válido.').refine((value) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) > 0n;
  }, 'El tope debe ser mayor a 0.'),
  alert_threshold: z.number().int().min(1, 'El porcentaje mínimo es 1.').max(100, 'El porcentaje máximo es 100.'),
});
export type BudgetFormValues = z.infer<typeof schema>;

interface Props {
  categories: Category[];
  budget: Budget | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: BudgetFormValues) => Promise<void>;
}

export function BudgetFormModal({ categories, budget, saving, onClose, onSubmit }: Props) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<BudgetFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category_id: '', monthly_limit: '', alert_threshold: 80 },
  });
  useEffect(() => reset(budget ? {
    category_id: budget.category_id,
    monthly_limit: budget.monthly_limit ?? '',
    alert_threshold: budget.alert_threshold,
  } : { category_id: '', monthly_limit: '', alert_threshold: 80 }), [budget, reset]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="budget-form-title" className="fixed bottom-0 left-0 right-0 z-50 max-h-[94dvh] w-full overflow-y-auto rounded-t-xl bg-white px-6 pt-6 pb-20 shadow-lg sm:static sm:bottom-auto sm:left-auto sm:right-auto sm:mx-auto sm:max-w-lg sm:rounded-xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <h2 id="budget-form-title" className="text-lg font-semibold text-ink-900">{budget ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-700 hover:bg-bg"><X aria-hidden="true" size={20} /></button>
        </header>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="budget-category" className="block text-sm font-medium text-ink-700">Categoría</label>
            <div className="relative mt-1">
              <select id="budget-category" disabled={Boolean(budget)} {...register('category_id')} className="min-h-11 w-full appearance-none rounded-md border border-ink-300 bg-white px-3 pr-10 text-sm text-ink-900 disabled:bg-bg">
                <option value="">Selecciona una categoría</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" size={18} />
            </div>
            {errors.category_id && <p className="mt-1 text-sm text-danger-600">{errors.category_id.message}</p>}
          </div>
          <div>
            <label htmlFor="budget-limit" className="block text-sm font-medium text-ink-700">Tope mensual (S/)</label>
            <input id="budget-limit" inputMode="decimal" {...register('monthly_limit')} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3 text-sm text-ink-900" />
            {errors.monthly_limit && <p className="mt-1 text-sm text-danger-600">{errors.monthly_limit.message}</p>}
          </div>
          <div>
            <label htmlFor="budget-threshold" className="block text-sm font-medium text-ink-700">Porcentaje de alerta</label>
            <input id="budget-threshold" type="number" min={1} max={100} {...register('alert_threshold', { valueAsNumber: true })} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3 text-sm text-ink-900" />
            {errors.alert_threshold && <p className="mt-1 text-sm text-danger-600">{errors.alert_threshold.message}</p>}
          </div>
          <div className="mt-6 flex w-full flex-row gap-3">
            <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-md border border-ink-300 px-3 text-sm font-medium text-ink-900">Cancelar</button>
            <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-md bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{saving ? 'Guardando…' : budget ? 'Guardar cambios' : 'Crear presupuesto'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

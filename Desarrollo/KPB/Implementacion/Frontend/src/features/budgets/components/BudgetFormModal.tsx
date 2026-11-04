import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../../../lib/errors';
import { useBudgets } from '../hooks/useBudgets';
import { replaceBudgetThresholds, updateBudget } from '../services/budgetService';
import type { Budget, BudgetPeriodType, BudgetUpdatePayload, Currency } from '../types/budget.types';
import { normalizeMoney, parseMoneyToCents } from '../utils/money';

const presets = [75, 80, 90, 100];
const schema = z.object({
  category_id: z.string().min(1, 'Selecciona una categoría de gasto.'),
  currency: z.enum(['PEN', 'USD']),
  amount: z.string().trim().superRefine((value, ctx) => {
    const cents = parseMoneyToCents(value);
    if (cents === null || cents <= 0n || normalizeMoney(value) === null) {
      ctx.addIssue({ code: 'custom', message: 'El tope debe ser mayor a 0.' });
    }
  }),
  period_type: z.enum(['WEEKLY', 'MONTHLY', 'CUSTOM']),
  start_date: z.string(),
  period_days: z.string(),
  thresholds: z.array(z.number().int().min(1).max(100)).min(1, 'Selecciona al menos un porcentaje de alerta.'),
}).superRefine((value, ctx) => {
  if (value.period_type === 'CUSTOM') {
    if (!value.start_date) ctx.addIssue({ code: 'custom', path: ['start_date'], message: 'Indica la fecha de inicio.' });
    const days = Number(value.period_days);
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      ctx.addIssue({ code: 'custom', path: ['period_days'], message: 'Los días deben estar entre 1 y 366.' });
    }
  }
});

type FormValues = z.infer<typeof schema>;
export interface BudgetFormModalProps {
  budget?: Budget;
  onClose: () => void;
  onSaved?: (budget: Budget) => void;
}

const defaults: FormValues = {
  category_id: '', currency: 'PEN', amount: '', period_type: 'MONTHLY',
  start_date: '', period_days: '30', thresholds: [80],
};

export function BudgetFormModal({ budget, onClose, onSaved }: BudgetFormModalProps) {
  const isEditMode = Boolean(budget);
  const { categories, isCategoriesLoading, categoriesError, save, isSaving } = useBudgets('ACTIVE');
  const [customThreshold, setCustomThreshold] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, reset, watch, setValue, setError, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema), defaultValues: budget ? {
      category_id: budget.category.id, currency: budget.currency, amount: budget.amount,
      period_type: budget.period_type, start_date: budget.start_date ?? '',
      period_days: budget.period_days ? String(budget.period_days) : '',
      thresholds: budget.thresholds.map(({ percentage }) => percentage),
    } : defaults,
  });

  useEffect(() => {
    if (!budget) return;
    reset({ category_id: budget.category.id, currency: budget.currency, amount: budget.amount,
      period_type: budget.period_type, start_date: budget.start_date ?? '',
      period_days: budget.period_days ? String(budget.period_days) : '',
      thresholds: budget.thresholds.map(({ percentage }) => percentage) });
  }, [budget, reset]);

  const values = watch();
  const loadingError = categoriesError instanceof Error ? categoriesError.message : '';

  function toggleThreshold(value: number) {
    const current = values.thresholds ?? [];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value].sort((a, b) => a - b);
    setValue('thresholds', next, { shouldDirty: true, shouldValidate: true });
  }

  function addCustomThreshold() {
    const value = Number(customThreshold);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      setError('thresholds', { message: 'Ingresa un porcentaje entre 1% y 100%.' }); return;
    }
    if (values.thresholds.includes(value)) {
      setError('thresholds', { message: 'Ese porcentaje ya está agregado.' }); return;
    }
    setValue('thresholds', [...values.thresholds, value].sort((a, b) => a - b), { shouldDirty: true, shouldValidate: true });
    setCustomThreshold('');
  }

  async function submit(form: FormValues) {
    setSubmitError('');
    const amount = normalizeMoney(form.amount);
    if (!amount) return;
    const period = form.period_type as BudgetPeriodType;
    const startDate = period === 'CUSTOM' ? form.start_date : null;
    const days = period === 'CUSTOM' ? Number(form.period_days) : null;
    const update: BudgetUpdatePayload = { amount, period_type: period, start_date: startDate, period_days: days };
    try {
      setSubmitting(true);
      let saved: Budget;
      if (budget) {
        saved = await updateBudget(budget.id, update);
        await replaceBudgetThresholds(budget.id, form.thresholds);
      } else {
        saved = await save({ createPayload: {
          category_id: form.category_id, currency: form.currency as Currency, amount,
          period_type: period, start_date: startDate, period_days: days, thresholds: form.thresholds,
        }, updatePayload: update, thresholds: form.thresholds });
      }
      onSaved?.(saved);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.details) {
        for (const detail of cause.details) {
          if (['amount', 'category_id', 'start_date', 'period_days'].includes(detail.field)) {
            setError(detail.field as keyof FormValues, { message: detail.message });
          }
        }
      }
      setSubmitError(cause instanceof Error ? cause.message : 'No se pudo guardar el presupuesto.');
    } finally { setSubmitting(false); }
  }

  if (typeof document === 'undefined') return null;
  const selectClass = 'w-full appearance-none rounded-xl border border-gray-300 px-4 py-3 pr-11 text-base text-gray-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200';
  const disabled = submitting || isSaving;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !disabled) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="budget-modal-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <header className="mb-6">
          <h2 id="budget-modal-title" className="text-xl font-bold text-gray-900">{isEditMode ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
          <p className="mt-1 text-sm text-gray-500">Define el límite para esta categoría.</p>
        </header>
        <form onSubmit={handleSubmit(submit)} noValidate>
          <div className="flex flex-col gap-6">
            {submitError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitError}</p>}
            {(loadingError || (isCategoriesLoading && !isEditMode)) && <p role={loadingError ? 'alert' : 'status'} className="text-sm text-gray-500">{loadingError || 'Cargando categorías…'}</p>}
            <div>
              <label htmlFor="budget-category" className="mb-1.5 block text-sm font-medium text-gray-800">Categoría</label>
              <div className="relative mb-4 w-full"><select id="budget-category" disabled={isEditMode} {...register('category_id')} className={`${selectClass} ${values.category_id ? 'text-gray-900' : 'text-gray-500'} disabled:bg-gray-100`}>
                <option value="">{'Selecciona una categoría'}</option>
                {isEditMode && budget && !categories.some((category) => category.id === budget.category.id) && <option value={budget.category.id}>{budget.category.name}</option>}
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} /></div>
              {errors.category_id && <p role="alert" className="mt-1 text-xs text-red-600">{errors.category_id.message}</p>}
            </div>
            <div>
              <label htmlFor="budget-currency" className="mb-1.5 block text-sm font-medium text-gray-800">Moneda</label>
              <div className="relative"><select id="budget-currency" disabled={isEditMode} {...register('currency')} className={`${selectClass} disabled:bg-gray-100`}>
                <option value="PEN">Sol peruano (PEN)</option><option value="USD">Dólar estadounidense (USD)</option>
              </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} /></div>
            </div>
            <div>
              <label htmlFor="budget-amount" className="mb-1.5 block text-sm font-medium text-gray-800">Tope del periodo</label>
              <input id="budget-amount" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={values.currency === 'PEN' ? 'S/ 150.00' : '$ 150.00'} {...register('amount')} aria-invalid={Boolean(errors.amount)} className="h-12 w-full rounded-xl border border-gray-300 px-4 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200" />
              <p className="mt-2 text-xs text-gray-500">El máximo que quieres gastar en esta categoría durante el periodo.</p>
              {errors.amount && <p role="alert" className="mt-1 text-xs text-red-600">{errors.amount.message}</p>}
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-800">Porcentajes de alerta</legend>
              <div className="flex flex-wrap gap-2">{presets.map((percentage) => {
                const selected = values.thresholds.includes(percentage);
                return <button key={percentage} type="button" aria-pressed={selected} onClick={() => toggleThreshold(percentage)} className={`h-10 rounded-full border px-4 text-sm font-medium ${selected ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-300 bg-white text-gray-700'}`}>{percentage}%</button>;
              })}</div>
              <div className="mt-3 flex w-full items-center gap-2 overflow-hidden">
                <input aria-label="Porcentaje personalizado" type="number" min="1" max="100" value={customThreshold} onChange={(event) => setCustomThreshold(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomThreshold(); } }} placeholder="Otro porcentaje" className="h-12 flex-1 min-w-0 rounded-xl border border-gray-300 px-3 text-sm" />
                <button type="button" onClick={addCustomThreshold} aria-label="Agregar porcentaje" className="flex shrink-0 w-12 h-12 items-center justify-center rounded-xl border border-gray-300 text-teal-700 hover:bg-teal-50"><Plus aria-hidden="true" size={20} /></button>
              </div>
              {values.thresholds.filter((item) => !presets.includes(item)).map((item) => <button key={item} type="button" onClick={() => toggleThreshold(item)} className="mr-2 mt-2 rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-700">{item}% ×</button>)}
              {errors.thresholds && <p role="alert" className="mt-1 text-xs text-red-600">{errors.thresholds.message}</p>}
            </fieldset>
            <div>
              <label htmlFor="budget-period" className="mb-1.5 block text-sm font-medium text-gray-800">Periodo</label>
              <div className="relative"><select id="budget-period" {...register('period_type')} className={selectClass}><option value="MONTHLY">Mensual</option><option value="WEEKLY">Semanal</option><option value="CUSTOM">Personalizado</option></select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} /></div>
            </div>
            {values.period_type === 'CUSTOM' && <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="budget-start-date" className="mb-1.5 block text-sm font-medium text-gray-800">Fecha de inicio</label><input id="budget-start-date" type="date" {...register('start_date')} className="h-12 w-full rounded-xl border border-gray-300 px-3" />{errors.start_date && <p role="alert" className="mt-1 text-xs text-red-600">{errors.start_date.message}</p>}</div>
              <div><label htmlFor="budget-period-days" className="mb-1.5 block text-sm font-medium text-gray-800">Días del periodo</label><input id="budget-period-days" type="number" min="1" max="366" {...register('period_days')} className="h-12 w-full rounded-xl border border-gray-300 px-3" />{errors.period_days && <p role="alert" className="mt-1 text-xs text-red-600">{errors.period_days.message}</p>}</div>
            </div>}
          </div>
          <div className="mt-8 flex gap-4">
            <button type="button" disabled={disabled} onClick={onClose} className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-3 text-center font-medium leading-5 text-gray-700 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={disabled || isCategoriesLoading} className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-teal-600 px-4 py-3 text-center font-medium leading-5 text-white hover:bg-teal-700 disabled:cursor-wait disabled:opacity-60">{disabled ? 'Guardando…' : isEditMode ? 'Guardar cambios' : 'Crear presupuesto'}</button>
          </div>
        </form>
      </section>
    </div>, document.body,
  );
}

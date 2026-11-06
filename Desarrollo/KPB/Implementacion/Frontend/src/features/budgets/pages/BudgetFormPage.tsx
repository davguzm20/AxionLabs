import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError } from '../../../lib/errors';
import { putThresholds } from '../../cu08/services/thresholdService';
import { useNotificationPreferences } from '../../notifications/hooks/useNotificationPreferences';
import { useBudgetDetails, useBudgets } from '../hooks/useBudgets';
import { updateBudget } from '../services/budgetService';
import { normalizeMoney, parseMoneyToCents } from '../utils/money';
import type { BudgetCreatePayload, BudgetPeriodType, BudgetUpdatePayload, Currency } from '../types/budget.types';

const presetThresholds = [75, 80, 90, 100];
const MAX_DAYS = 366;

const formSchema = z.object({
  category_id: z.string().min(1, 'Selecciona una categoría de gasto.'),
  currency: z.enum(['PEN', 'USD']),
  amount: z.string().trim().superRefine((value, context) => {
    const cents = parseMoneyToCents(value);
    if (cents === null || normalizeMoney(value) === null) {
      context.addIssue({ code: 'custom', message: 'Ingresa un monto válido (máximo 99,999,999.99).' });
    } else if (cents <= 0n) {
      context.addIssue({ code: 'custom', message: 'El tope debe ser mayor que S/ 0.00.' });
    }
  }),
  period_type: z.enum(['WEEKLY', 'MONTHLY', 'CUSTOM']),
  start_date: z.string(),
  period_days: z.string(),
  thresholds: z.array(z.number().int().min(1).max(100)).min(1, 'Agrega al menos un porcentaje de alerta.'),
}).superRefine((values, context) => {
  if (values.thresholds.length !== new Set(values.thresholds).size) {
    context.addIssue({ code: 'custom', path: ['thresholds'], message: 'No repitas porcentajes de alerta.' });
  }

  if (values.period_type === 'CUSTOM') {
    const startDate = new Date(`${values.start_date}T00:00:00.000Z`);
    const validStartDate = !Number.isNaN(startDate.getTime())
      && startDate.toISOString().slice(0, 10) === values.start_date;
    if (!validStartDate) {
      context.addIssue({ code: 'custom', path: ['start_date'], message: 'Indica la fecha de inicio.' });
    }
    const days = Number(values.period_days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      context.addIssue({ code: 'custom', path: ['period_days'], message: 'Los días deben estar entre 1 y 366.' });
    }
  }
});

type FormValues = z.infer<typeof formSchema>;

const defaultValues: FormValues = {
  category_id: '',
  currency: 'PEN',
  amount: '',
  period_type: 'MONTHLY',
  start_date: '',
  period_days: '30',
  thresholds: [80],
};

export function BudgetFormPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { budgetId } = useParams();
  const isEditing = Boolean(budgetId);
  const budgetQuery = useBudgetDetails(budgetId);
  const { preferences, isLoading: isPreferencesLoading } = useNotificationPreferences();
  const {
    categories,
    isCategoriesLoading,
    categoriesError,
    save,
    isSaving,
  } = useBudgets('ACTIVE');
  const [submitError, setSubmitError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customThreshold, setCustomThreshold] = useState('');
  const budget = budgetQuery.data;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  useEffect(() => {
    if (!budget) return;
    reset({
      category_id: budget.category.id,
      currency: budget.currency,
      amount: budget.amount,
      period_type: budget.period_type,
      start_date: budget.start_date ?? '',
      period_days: budget.period_days ? String(budget.period_days) : '',
      thresholds: budget.thresholds.map((threshold) => threshold.percentage),
    });
  }, [budget, reset]);

  const values = watch();
  const budgetCategoryIsListed = budget ? categories.some((category) => category.id === budget.category.id) : true;
  const isLoading = isCategoriesLoading || (isEditing && budgetQuery.isPending);
  const loadError = categoriesError ?? budgetQuery.error;

  function toggleThreshold(value: number) {
    const current = values.thresholds ?? [];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value].sort((left, right) => left - right);
    setValue('thresholds', next, { shouldDirty: true, shouldValidate: true });
  }

  function addCustomThreshold() {
    const value = Number(customThreshold);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      setError('thresholds', { message: 'Ingresa un porcentaje entre 1% y 100%.' });
      return;
    }
    if (values.thresholds.includes(value)) {
      setError('thresholds', { message: 'Ese porcentaje ya está agregado.' });
      return;
    }
    setValue('thresholds', [...values.thresholds, value].sort((left, right) => left - right), {
      shouldDirty: true,
      shouldValidate: true,
    });
    setCustomThreshold('');
  }

  async function onSubmit(formValues: FormValues) {
    setSubmitError(undefined);
    const amount = normalizeMoney(formValues.amount);
    if (!amount) return;

    const periodType = formValues.period_type as BudgetPeriodType;
    const startDate = periodType === 'CUSTOM' ? formValues.start_date : null;
    const periodDays = periodType === 'CUSTOM' ? Number(formValues.period_days) : null;
    const createPayload: BudgetCreatePayload = {
      category_id: formValues.category_id,
      currency: formValues.currency as Currency,
      amount,
      period_type: periodType,
      start_date: startDate,
      period_days: periodDays,
      thresholds: formValues.thresholds,
    };
    const updatePayload: BudgetUpdatePayload = {
      amount,
      period_type: periodType,
      start_date: startDate,
      period_days: periodDays,
    };

    try {
      setIsSubmitting(true);
      if (budgetId && budget) {
        await updateBudget(budgetId, updatePayload);
        await putThresholds(budget.category.id, {
          thresholds: formValues.thresholds,
          channels: preferences?.email_notifications ? ['app', 'email'] : ['app'],
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['budgets'] }),
          queryClient.invalidateQueries({ queryKey: ['budget', budgetId] }),
        ]);
      } else {
        await save({ budgetId, createPayload, updatePayload, thresholds: formValues.thresholds });
      }
      navigate('/presupuestos', { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.details) {
        for (const detail of cause.details) {
          if (detail.field === 'amount' || detail.field === 'category_id' || detail.field === 'start_date' || detail.field === 'period_days') {
            setError(detail.field, { message: detail.message });
          }
        }
      }
      setSubmitError(cause instanceof Error ? cause.message : 'No se pudo guardar el presupuesto. Intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function leaveForm() {
    if (isDirty && !window.confirm('¿Descartar los cambios del presupuesto?')) return;
    navigate('/presupuestos');
  }

  if (isLoading) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-sm sm:p-6">
        <main className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-bg p-4 shadow-xl sm:p-6">
        <div className="animate-pulse space-y-4 py-2" role="status" aria-label="Cargando formulario">
          <div className="h-12 rounded-lg bg-ink-300/50" />
          <div className="h-12 rounded-lg bg-ink-300/50" />
          <div className="h-12 rounded-lg bg-ink-300/50" />
        </div>
        </main>
      </div>, document.body,
    );
  }

  if (loadError || (isEditing && !budget)) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-sm sm:p-6">
        <section role="alert" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-danger bg-white p-5 shadow-xl">
          <p className="text-sm text-danger-600">{loadError instanceof Error ? loadError.message : 'No encontramos este presupuesto.'}</p>
          <button type="button" onClick={() => navigate('/presupuestos')} className="mt-4 min-h-11 rounded-md px-3 text-sm font-medium text-accent-600 underline">Volver a presupuestos</button>
        </section>
      </div>, document.body,
    );
  }

  return (
    createPortal(<div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/50 backdrop-blur-sm sm:items-center sm:p-6">
    <main role="dialog" aria-modal="true" aria-labelledby="budget-form-title" className="flex max-h-[90vh] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
      <header className="shrink-0 bg-white px-5 pt-6 sm:px-8">
        <h1 id="budget-form-title" className="text-xl font-bold text-gray-900">{isEditing ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h1>
        <p className="mt-1 text-sm text-gray-500">Define el límite para esta categoría.</p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5 sm:px-8">
          <div className="mx-auto max-w-2xl space-y-6">
            {submitError && <p role="alert" className="rounded-lg border border-danger bg-white p-3 text-sm text-danger-600">{submitError}</p>}

            <div>
              <label htmlFor="budget-category" className="mb-1.5 block text-sm font-medium text-ink-900">Categoría</label>
              <div className="relative mb-4 w-full">
                {isEditing && <input type="hidden" {...register('category_id')} />}
                <select id="budget-category" disabled={isEditing} aria-invalid={Boolean(errors.category_id)} aria-describedby={errors.category_id ? 'budget-category-error' : undefined} {...(!isEditing ? register('category_id') : { value: budget?.category.id ?? '' })} className={`w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-11 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-200 ${values.category_id ? 'text-gray-900' : 'text-gray-500'}`}>
                  <option value="">{'Selecciona una categoría'}</option>
                  {isEditing && budget && !budgetCategoryIsListed && <option value={budget.category.id}>{budget.category.name}</option>}
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              </div>
              {errors.category_id && <p id="budget-category-error" role="alert" className="mt-1 text-xs text-danger-600">{errors.category_id.message}</p>}
            </div>

            <div>
              <label htmlFor="budget-currency" className="mb-1.5 block text-sm font-medium text-ink-900">Moneda</label>
              {isEditing && <input type="hidden" {...register('currency')} />}
              <select id="budget-currency" disabled={isEditing} {...(!isEditing ? register('currency') : { value: budget?.currency ?? 'PEN' })} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900 disabled:bg-bg">
                <option value="PEN">Sol peruano (PEN)</option>
                <option value="USD">Dólar estadounidense (USD)</option>
              </select>
            </div>

            <div>
              <label htmlFor="budget-amount" className="mb-1.5 block text-sm font-medium text-ink-900">Tope del periodo</label>
              <input
                id="budget-amount"
                inputMode="decimal"
                placeholder={values.currency === 'PEN' ? 'S/ 150.00' : '$ 150.00'}
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={errors.amount ? 'budget-amount-error' : 'budget-amount-help'}
                {...register('amount')}
                className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900"
              />
              <p id="budget-amount-help" className="mt-2 text-xs text-ink-500">El máximo que quieres gastar aquí cada periodo. No es dinero guardado ni se descuenta de tus cuentas.</p>
              {errors.amount && <p id="budget-amount-error" role="alert" className="mt-1 text-xs text-danger-600">{errors.amount.message}</p>}
            </div>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink-900">Porcentajes de alerta</legend>
              <p className="mb-2 text-xs text-ink-500">Te avisamos al llegar a uno de estos porcentajes del tope.</p>
              <div className="flex flex-wrap gap-2">
                {presetThresholds.map((threshold) => {
                  const selected = values.thresholds.includes(threshold);
                  return <button key={threshold} type="button" aria-pressed={selected} onClick={() => toggleThreshold(threshold)} className={`min-h-11 min-w-14 rounded-md border px-3 text-sm font-medium ${selected ? 'border-accent-600 bg-accent-100 text-accent-600' : 'border-ink-300 bg-white text-ink-700'}`}>{threshold}%</button>;
                })}
              </div>
              <div className="mt-2 flex w-full items-center gap-2 overflow-hidden">
                <label className="sr-only" htmlFor="custom-threshold">Otro porcentaje</label>
                <input id="custom-threshold" type="number" min={1} max={100} value={customThreshold} onChange={(event) => setCustomThreshold(event.target.value)} placeholder="Otro porcentaje" className="h-12 flex-1 min-w-0 rounded-md border border-ink-300 bg-white px-3 text-sm" />
                <button type="button" onClick={addCustomThreshold} aria-label="Agregar porcentaje" className="flex shrink-0 w-12 h-12 items-center justify-center rounded-md border border-ink-300 bg-white text-accent-600 hover:bg-accent-100"><Plus aria-hidden="true" size={20} /></button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2" aria-label="Porcentajes agregados">
                {values.thresholds.filter((threshold) => !presetThresholds.includes(threshold)).map((threshold) => <button key={threshold} type="button" onClick={() => toggleThreshold(threshold)} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent-100 px-3 text-xs font-medium text-accent-600">{threshold}% <X aria-hidden="true" size={14} /><span className="sr-only">Quitar {threshold}%</span></button>)}
              </div>
              {errors.thresholds && <p role="alert" className="mt-1 text-xs text-danger-600">{errors.thresholds.message}</p>}
            </fieldset>

            <div>
              <label htmlFor="budget-period" className="mb-1.5 block text-sm font-medium text-ink-900">Periodo</label>
              <select id="budget-period" {...register('period_type')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900">
                <option value="WEEKLY">Semanal</option>
                <option value="MONTHLY">Mensual</option>
                <option value="CUSTOM">Personalizado</option>
              </select>
            </div>

            {values.period_type === 'CUSTOM' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="budget-start-date" className="mb-1.5 block text-sm font-medium text-ink-900">Fecha de inicio</label>
                  <input id="budget-start-date" type="date" aria-invalid={Boolean(errors.start_date)} aria-describedby={errors.start_date ? 'budget-start-date-error' : undefined} {...register('start_date')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900" />
                  {errors.start_date && <p id="budget-start-date-error" role="alert" className="mt-1 text-xs text-danger-600">{errors.start_date.message}</p>}
                </div>
                <div>
                  <label htmlFor="budget-period-days" className="mb-1.5 block text-sm font-medium text-ink-900">Días del periodo</label>
                  <input id="budget-period-days" type="number" min={1} max={MAX_DAYS} inputMode="numeric" aria-invalid={Boolean(errors.period_days)} aria-describedby={errors.period_days ? 'budget-period-days-error' : undefined} {...register('period_days')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900" />
                  {errors.period_days && <p id="budget-period-days-error" role="alert" className="mt-1 text-xs text-danger-600">{errors.period_days.message}</p>}
                </div>
              </div>
            )}

          </div>
        </div>

        <footer className="shrink-0 bg-white px-5 pb-10 pt-4 sm:px-8">
          <div className="mx-auto mt-6 flex max-w-2xl gap-4">
            <button type="button" onClick={leaveForm} disabled={isSubmitting || isSaving} className="flex-1 rounded-xl border border-gray-300 bg-white py-3 font-medium text-gray-700 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={isSubmitting || isSaving || (isEditing && isPreferencesLoading)} aria-busy={isSubmitting || isSaving} className="flex-1 rounded-xl bg-teal-600 py-3 font-medium text-white hover:bg-teal-700 disabled:cursor-wait disabled:opacity-60">
              {isSubmitting || isSaving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Crear presupuesto'}
            </button>
          </div>
        </footer>
      </form>
    </main>
    </div>, document.body)
  );
}

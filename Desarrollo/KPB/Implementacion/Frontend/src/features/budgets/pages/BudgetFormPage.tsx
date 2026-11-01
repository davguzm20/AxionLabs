import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Bell, ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../../../lib/errors';
import { useBudgetDetails, useBudgets } from '../hooks/useBudgets';
import { calculatePercentage, formatMoney, normalizeMoney, parseMoneyToCents } from '../utils/money';
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

function centsToDecimal(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function BudgetFormPage() {
  const navigate = useNavigate();
  const { budgetId } = useParams();
  const isEditing = Boolean(budgetId);
  const budgetQuery = useBudgetDetails(budgetId);
  const {
    categories,
    isCategoriesLoading,
    categoriesError,
    save,
    isSaving,
  } = useBudgets('ACTIVE');
  const [submitError, setSubmitError] = useState<string>();
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
  const selectedCategory = categories.find((category) => category.id === values.category_id) ?? budget?.category;
  const budgetCategoryIsListed = budget ? categories.some((category) => category.id === budget.category.id) : true;
  const normalizedAmount = normalizeMoney(values.amount) ?? '0.00';
  const previewConsumed = budget?.consumed ?? '0.00';
  const previewPercentage = useMemo(
    () => calculatePercentage(previewConsumed, normalizedAmount),
    [normalizedAmount, previewConsumed],
  );
  const amountCents = parseMoneyToCents(normalizedAmount) ?? 0n;
  const consumedCents = parseMoneyToCents(previewConsumed) ?? 0n;
  const previewRemaining = centsToDecimal(amountCents - consumedCents);
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
      await save({ budgetId, createPayload, updatePayload, thresholds: formValues.thresholds });
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
    }
  }

  function leaveForm() {
    if (isDirty && !window.confirm('¿Descartar los cambios del presupuesto?')) return;
    navigate('/presupuestos');
  }

  if (isLoading) {
    return (
      <main className="h-full overflow-y-auto bg-bg px-4 pb-8 sm:px-6">
        <div className="mx-auto max-w-2xl animate-pulse space-y-4 py-6" role="status" aria-label="Cargando formulario">
          <div className="h-12 rounded-lg bg-ink-300/50" />
          <div className="h-12 rounded-lg bg-ink-300/50" />
          <div className="h-12 rounded-lg bg-ink-300/50" />
        </div>
      </main>
    );
  }

  if (loadError || (isEditing && !budget)) {
    return (
      <main className="h-full overflow-y-auto bg-bg px-4 pb-8 sm:px-6">
        <section role="alert" className="mx-auto mt-6 max-w-2xl rounded-xl border border-danger bg-white p-5">
          <p className="text-sm text-danger-600">{loadError instanceof Error ? loadError.message : 'No encontramos este presupuesto.'}</p>
          <button type="button" onClick={() => navigate('/presupuestos')} className="mt-4 min-h-11 rounded-md px-3 text-sm font-medium text-accent-600 underline">Volver a presupuestos</button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-bg">
      <header className="sticky top-0 z-10 flex h-[4.5rem] shrink-0 items-center gap-3 border-b border-ink-300 bg-white px-4 sm:px-6">
        <button type="button" onClick={leaveForm} aria-label="Volver a presupuestos" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-900 hover:bg-bg">
          <ArrowLeft aria-hidden="true" size={22} />
        </button>
        <h1 className="font-semibold text-ink-900">{isEditing ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h1>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {submitError && <p role="alert" className="rounded-lg border border-danger bg-white p-3 text-sm text-danger-600">{submitError}</p>}

            <div>
              <label htmlFor="budget-category" className="mb-1.5 block text-sm font-medium text-ink-900">Categoría</label>
              <div className="relative">
                {isEditing && <input type="hidden" {...register('category_id')} />}
                <select
                  id="budget-category"
                  disabled={isEditing}
                  aria-invalid={Boolean(errors.category_id)}
                  aria-describedby={errors.category_id ? 'budget-category-error' : undefined}
                  {...(!isEditing ? register('category_id') : { value: budget?.category.id ?? '' })}
                  className="min-h-11 w-full appearance-none rounded-md border border-ink-300 bg-white px-3 pr-10 text-sm text-ink-900 disabled:bg-bg"
                >
                  <option value="">Selecciona una categoría</option>
                  {isEditing && budget && !budgetCategoryIsListed && <option value={budget.category.id}>{budget.category.name}</option>}
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" size={18} />
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
              <p id="budget-amount-help" className="mt-1 text-xs text-ink-500">El máximo que quieres gastar aquí cada periodo. No es dinero guardado ni se descuenta de tus cuentas.</p>
              {errors.amount && <p id="budget-amount-error" role="alert" className="mt-1 text-xs text-danger-600">{errors.amount.message}</p>}
            </div>

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

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink-900">Porcentaje de alerta</legend>
              <p className="mb-2 text-xs text-ink-500">Te avisamos al llegar a uno de estos porcentajes del tope.</p>
              <div className="flex flex-wrap gap-2">
                {presetThresholds.map((threshold) => {
                  const selected = values.thresholds.includes(threshold);
                  return (
                    <button
                      key={threshold}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleThreshold(threshold)}
                      className={`min-h-11 min-w-14 rounded-md border px-3 text-sm font-medium ${selected ? 'border-accent-600 bg-accent-100 text-accent-600' : 'border-ink-300 bg-white text-ink-700'}`}
                    >
                      {threshold}%
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <label className="sr-only" htmlFor="custom-threshold">Otro porcentaje</label>
                <input id="custom-threshold" type="number" min={1} max={100} value={customThreshold} onChange={(event) => setCustomThreshold(event.target.value)} placeholder="Otro porcentaje" className="min-h-11 min-w-0 flex-1 rounded-md border border-ink-300 bg-white px-3 text-sm" />
                <button type="button" onClick={addCustomThreshold} aria-label="Agregar porcentaje" className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-ink-300 bg-white text-accent-600 hover:bg-accent-100">
                  <Plus aria-hidden="true" size={20} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2" aria-label="Porcentajes agregados">
                {values.thresholds.filter((threshold) => !presetThresholds.includes(threshold)).map((threshold) => (
                  <button key={threshold} type="button" onClick={() => toggleThreshold(threshold)} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent-100 px-3 text-xs font-medium text-accent-600">
                    {threshold}% <X aria-hidden="true" size={14} />
                    <span className="sr-only">Quitar {threshold}%</span>
                  </button>
                ))}
              </div>
              {errors.thresholds && <p role="alert" className="mt-1 text-xs text-danger-600">{errors.thresholds.message}</p>}
            </fieldset>

            <section aria-labelledby="budget-preview-heading" className="space-y-2">
              <h2 id="budget-preview-heading" className="text-sm font-semibold text-ink-900">Así se verá</h2>
              <article className="rounded-xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate font-medium text-ink-900">{selectedCategory?.name || 'Categoría'}</p>
                  <span className="text-xs text-ink-500">{previewPercentage.toFixed(1)}%</span>
                </div>
                <p className="mt-2 text-sm text-ink-700">Te quedan {formatMoney(previewRemaining, values.currency)}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-300/50" aria-hidden="true">
                  <div className={`h-full rounded-full ${previewPercentage >= 100 ? 'bg-danger-600' : previewPercentage >= 80 ? 'bg-warning-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(previewPercentage, 100)}%` }} />
                </div>
                <div className="mt-2 flex justify-between gap-2 text-xs text-ink-500">
                  <span>Gastado: {formatMoney(previewConsumed, values.currency)}</span>
                  <span>Tope: {formatMoney(normalizedAmount, values.currency)}</span>
                </div>
              </article>
              <p className="flex items-center gap-2 text-xs text-ink-500"><Bell aria-hidden="true" size={15} /> Te avisamos cuando llegues a los porcentajes seleccionados.</p>
              {values.period_type === 'MONTHLY' && <p className="text-xs text-ink-500">Se reinicia el día 1 de cada mes.</p>}
              {values.period_type === 'WEEKLY' && <p className="text-xs text-ink-500">Se reinicia cada lunes.</p>}
            </section>
          </div>
        </div>

        <footer className="sticky bottom-0 z-10 shrink-0 border-t border-ink-300 bg-white px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto flex max-w-2xl gap-3">
            <button type="button" onClick={leaveForm} disabled={isSaving} className="min-h-11 flex-1 rounded-md border border-danger-600 bg-white px-3 text-sm font-semibold text-danger-600 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={isSaving} aria-busy={isSaving} className="min-h-11 flex-1 rounded-md bg-accent-600 px-3 text-sm font-semibold text-white hover:bg-accent-500 disabled:cursor-wait disabled:opacity-60">
              {isSaving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Crear presupuesto'}
            </button>
          </div>
        </footer>
      </form>
    </main>
  );
}

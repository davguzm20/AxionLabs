import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Banknote, Landmark } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useWallets } from '../hooks/useWallets';
import { getWalletTransactionCount } from '../services/walletService';
import type { WalletCurrency, WalletType } from '../types/wallet.types';

const moneyPattern = /^\d{1,8}(?:\.\d{1,2})?$/;
const schema = z.object({
  name: z.string().trim().min(1, 'Ingresa un nombre para el monedero.').max(50, 'El nombre debe tener 50 caracteres o menos.'),
  type: z.enum(['bank', 'cash']),
  currency: z.enum(['PEN', 'USD']),
  balance: z.string().optional(),
}).superRefine((values, context) => {
  if (values.balance !== undefined && (!moneyPattern.test(values.balance) || BigInt(values.balance.split('.')[0] ?? '0') > 99_999_999n)) {
    context.addIssue({ code: 'custom', path: ['balance'], message: 'El saldo inicial debe estar entre 0.00 y 99,999,999.99.' });
  }
});

type FormValues = z.infer<typeof schema>;

function cleanBalance(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function WalletFormPage() {
  const navigate = useNavigate();
  const { walletId } = useParams();
  const editing = Boolean(walletId);
  const { wallets, loading: walletsLoading, saving, savingWalletId, loadError, actionError, clearError, create, update } = useWallets();
  const wallet = wallets.find((item) => item.id === walletId);
  const [initialLoading, setInitialLoading] = useState(editing);
  const [hasTransactions, setHasTransactions] = useState(false);
  const [checkingTransactions, setCheckingTransactions] = useState(editing);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const busy = saving || savingWalletId !== null;
  const formError = submitError ?? actionError ?? (editing ? null : loadError);

  const defaults = useMemo<FormValues>(() => ({
    name: wallet?.name ?? '',
    type: wallet?.type ?? 'cash',
    currency: wallet?.currency ?? 'PEN',
    balance: editing ? undefined : '0.00',
  }), [editing, wallet]);
  const { register, handleSubmit, reset, watch, formState: { errors, isDirty } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const selectedType = watch('type');

  useEffect(() => {
    if (!editing || !wallet) return;
    reset(defaults);
    setInitialLoading(false);
  }, [defaults, editing, reset, wallet]);

  useEffect(() => {
    if (!editing || !walletId) return;
    let active = true;
    getWalletTransactionCount(walletId)
      .then((count) => { if (active) setHasTransactions(count > 0); })
      .catch(() => { if (active) setSubmitError('No se pudo comprobar si el monedero tiene movimientos. Intenta nuevamente.'); })
      .finally(() => { if (active) { setCheckingTransactions(false); setInitialLoading(false); } });
    return () => { active = false; };
  }, [editing, walletId]);

  function leaveForm() {
    if (busy) return;
    if (isDirty && !window.confirm('¿Descartar los cambios del monedero?')) return;
    navigate('/monederos');
  }

  async function submit(values: FormValues) {
    if (busy) return;
    clearError();
    setSubmitError(null);
    const normalizedName = values.name.trim().toLocaleLowerCase('es-PE');
    if (wallets.some((item) => item.id !== walletId && item.name.trim().toLocaleLowerCase('es-PE') === normalizedName)) {
      setSubmitError('El nombre del monedero ya está en uso. Por favor, escoge uno distinto.');
      return;
    }

    if (editing && walletId) {
      const saved = await update(walletId, {
        name: values.name.trim(),
        type: values.type,
        ...(!hasTransactions ? { currency: values.currency as WalletCurrency } : {}),
      });
      if (!saved) return;
      navigate('/monederos', { replace: true, state: { walletMessage: 'Cambios guardados.' } });
      return;
    }

    const result = await create({
      name: values.name.trim(),
      type: values.type,
      currency: values.currency as WalletCurrency,
      initial_balance: cleanBalance(values.balance ?? '0'),
    });
    if (result) navigate('/monederos', { replace: true, state: { walletMessage: 'Monedero creado.' } });
  }

  if (walletsLoading || initialLoading) {
    return <main className="h-full overflow-y-auto bg-bg px-4 sm:px-6"><div role="status" aria-label="Cargando monedero" className="mx-auto max-w-2xl animate-pulse space-y-4 py-8"><div className="h-12 rounded-lg bg-ink-200" /><div className="h-12 rounded-lg bg-ink-200" /><div className="h-12 rounded-lg bg-ink-200" /></div></main>;
  }

  if (editing && !wallet) {
    return <main className="h-full overflow-y-auto bg-bg px-4 sm:px-6"><section role="alert" className="mx-auto mt-8 max-w-xl rounded-xl border border-danger bg-white p-5"><p className="text-sm text-danger-600">{loadError ?? 'No encontramos este monedero.'}</p><button type="button" onClick={() => navigate('/monederos')} className="mt-3 min-h-11 rounded-md px-3 text-sm font-semibold text-accent-700 hover:bg-accent-100">Volver a monederos</button></section></main>;
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-bg">
      <header className="sticky top-0 z-10 flex h-[4.5rem] shrink-0 items-center gap-3 border-b border-ink-300 bg-white px-4 sm:px-6">
        <button type="button" onClick={leaveForm} aria-label="Volver a monederos" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-900 hover:bg-bg"><ArrowLeft aria-hidden="true" size={22} /></button>
        <h1 className="font-semibold text-ink-900">{editing ? 'Editar monedero' : 'Nuevo monedero'}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6">
        <form onSubmit={handleSubmit(submit)} noValidate className="mx-auto flex min-h-full w-full max-w-2xl flex-col">
          <section className="mt-5 rounded-xl border border-ink-300 bg-white p-5 shadow-sm sm:p-7">
            <div className="space-y-5">
              <div>
                <label htmlFor="wallet-name" className="mb-1.5 block text-sm font-medium text-ink-800">Nombre</label>
                <input id="wallet-name" autoComplete="off" maxLength={50} placeholder="Ej. Ahorro" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'wallet-name-error' : undefined} {...register('name')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-100" />
                {errors.name && <p id="wallet-name-error" className="mt-1 text-sm text-danger-600">{errors.name.message}</p>}
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Tipo</legend>
                <div role="radiogroup" aria-label="Tipo de monedero" className="grid grid-cols-2 gap-3">
                  {(['cash', 'bank'] as const).map((type: WalletType) => <label key={type} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors ${selectedType === type ? 'border-accent-600 bg-accent-100 text-accent-700' : 'border-ink-300 bg-white text-ink-800 hover:bg-bg'}`}>
                    <input type="radio" value={type} {...register('type')} />{type === 'bank' ? <Landmark aria-hidden="true" size={17} /> : <Banknote aria-hidden="true" size={17} />}{type === 'bank' ? 'Banco' : 'Efectivo'}
                  </label>)}
                </div>
              </fieldset>

              <div>
                <label htmlFor="wallet-currency" className="mb-1.5 block text-sm font-medium text-ink-800">Moneda</label>
                <select id="wallet-currency" disabled={hasTransactions || checkingTransactions} {...register('currency')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-100 disabled:bg-bg disabled:text-ink-500">
                  <option value="PEN">Sol peruano (PEN)</option>
                  <option value="USD">Dólar estadounidense (USD)</option>
                </select>
                {hasTransactions && <p className="mt-1 text-xs text-ink-600">La moneda no se puede cambiar porque hay movimientos.</p>}
              </div>

              {!editing && <div>
                <label htmlFor="wallet-balance" className="mb-1.5 block text-sm font-medium text-ink-800">Saldo inicial</label>
                <div className="relative">
                  <span aria-hidden="true" className="absolute inset-y-0 left-3 flex items-center text-sm text-ink-500">{watch('currency') === 'USD' ? '$' : 'S/'}</span>
                  <input id="wallet-balance" inputMode="decimal" autoComplete="off" aria-invalid={Boolean(errors.balance)} aria-describedby={errors.balance ? 'wallet-balance-error' : 'wallet-balance-help'} {...register('balance')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white pl-10 pr-3 text-sm text-ink-900 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-100" />
                </div>
                {errors.balance ? <p id="wallet-balance-error" className="mt-1 text-sm text-danger-600">{errors.balance.message}</p> : <p id="wallet-balance-help" className="mt-1 text-xs text-ink-600">Indica cuánto dinero tienes al comenzar.</p>}
              </div>}
            </div>
          </section>

          {formError && <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-white px-4 py-3 text-sm text-danger-600">{formError}</p>}
          <footer className="sticky bottom-0 mt-auto flex gap-3 bg-bg py-5">
            <button type="submit" disabled={busy || checkingTransactions} className="min-h-11 flex-1 rounded-md bg-accent-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:cursor-wait disabled:opacity-60">{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear monedero'}</button>
            <button type="button" onClick={leaveForm} disabled={busy} className="min-h-11 flex-1 rounded-md border border-danger-600 bg-white px-4 text-sm font-semibold text-danger-600 hover:bg-red-50 disabled:opacity-60">Cancelar</button>
          </footer>
        </form>
      </div>
    </main>
  );
}

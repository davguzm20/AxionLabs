import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { Wallet, WalletType } from '../types/wallet.types';

const moneyPattern = /^-?\d{1,8}(?:\.\d{1,2})?$/;
const walletSchema = z.object({
  name: z.string().trim().min(1, 'El nombre no puede estar vacío.').max(50, 'El nombre debe tener 50 caracteres o menos.'),
  type: z.enum(['bank', 'cash']),
  currency: z.literal('PEN'),
  balance: z.string()
    .regex(moneyPattern, 'Ingresa un saldo válido (máximo 99,999,999.99).')
    .refine((value) => moneyPattern.test(value) && !value.startsWith('-') && BigInt(value.split('.')[0] ?? '0') <= 99_999_999n, 'El saldo debe estar entre 0.00 y 99,999,999.99.'),
});

export type WalletFormValues = z.infer<typeof walletSchema>;

interface WalletFormProps {
  wallet?: Wallet | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: WalletFormValues) => Promise<void>;
}

export function WalletForm({ wallet = null, saving, error, onClose, onSubmit }: WalletFormProps) {
  const editing = wallet !== null;
  const { register, handleSubmit, reset, formState: { errors } } = useForm<WalletFormValues>({
    resolver: zodResolver(walletSchema),
    defaultValues: { name: '', type: 'cash', currency: 'PEN', balance: '0.00' },
  });

  useEffect(() => {
    reset(wallet
      ? { name: wallet.name, type: wallet.type, currency: 'PEN', balance: wallet.balance }
      : { name: '', type: 'cash', currency: 'PEN', balance: '0.00' });
  }, [wallet, reset]);

  const fieldError = (message: string | undefined, id: string) => message
    ? <p id={id} className="mt-1 text-sm text-danger-600">{message}</p>
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="wallet-form-title" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-xl border border-gray-200 bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-xl sm:p-7">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="wallet-form-title" className="text-lg font-semibold text-ink-900">{editing ? 'Editar monedero' : 'Nuevo monedero'}</h2>
            <p className="mt-1 text-sm text-ink-500">{editing ? 'Actualiza el nombre o corrige el saldo.' : 'Agrega un lugar para organizar tu dinero.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="inline-flex size-11 items-center justify-center rounded-md text-ink-700 hover:bg-bg">
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div>
            <label htmlFor="wallet-name" className="mb-1.5 block text-sm font-medium text-ink-700">Nombre</label>
            <input id="wallet-name" autoComplete="off" placeholder="Ej. Ahorro" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'wallet-name-error' : undefined} {...register('name')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100" />
            {fieldError(errors.name?.message, 'wallet-name-error')}
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-700">Tipo</legend>
            <div role="radiogroup" aria-label="Tipo de monedero" className="grid grid-cols-2 gap-3">
              {(['bank', 'cash'] as const).map((type: WalletType) => (
                <label key={type} className={`flex min-h-11 items-center justify-center gap-2 rounded-md border border-ink-300 px-3 text-sm font-medium ${editing ? 'cursor-not-allowed bg-gray-100 text-ink-500' : 'cursor-pointer bg-white text-ink-900 hover:bg-bg'}`}>
                  <input type="radio" value={type} disabled={editing} {...register('type')} />
                  {type === 'bank' ? 'Banco' : 'Efectivo'}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="wallet-currency" className="mb-1.5 block text-sm font-medium text-ink-700">Moneda</label>
            <select id="wallet-currency" disabled className="min-h-11 w-full rounded-md border border-ink-300 bg-gray-100 px-3 text-sm text-ink-500 disabled:cursor-not-allowed" {...register('currency')}>
              <option value="PEN">Sol peruano (PEN)</option>
            </select>
            <p className="mt-1 text-xs text-ink-500">La moneda disponible para estos monederos es PEN.</p>
          </div>

          <div>
            <label htmlFor="wallet-balance" className="mb-1.5 block text-sm font-medium text-ink-700">{editing ? 'Saldo actual' : 'Saldo inicial'}</label>
            <div className="relative">
              <span aria-hidden="true" className="absolute inset-y-0 left-3 flex items-center text-sm text-ink-500">S/</span>
              <input id="wallet-balance" inputMode="decimal" autoComplete="off" aria-invalid={Boolean(errors.balance)} aria-describedby={errors.balance ? 'wallet-balance-error' : 'wallet-balance-help'} {...register('balance')} className="min-h-11 w-full rounded-md border border-ink-300 bg-white pl-10 pr-3 text-sm text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100" />
            </div>
            {fieldError(errors.balance?.message, 'wallet-balance-error')}
            {!errors.balance && <p id="wallet-balance-help" className="mt-1 text-xs text-ink-500">Ingresa un monto desde 0.00.</p>}
          </div>

          {error && <p role="alert" className="mt-3 text-sm text-danger-600">{error}</p>}

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-ink-300 bg-white px-4 font-semibold text-ink-900 hover:bg-bg">Cancelar</button>
            <button type="submit" disabled={saving} className="min-h-11 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">
              {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear monedero'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

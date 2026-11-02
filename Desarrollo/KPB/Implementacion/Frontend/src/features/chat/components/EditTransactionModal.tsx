import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { CategoryChoice } from '../transactionPreview.types';

const editTransactionSchema = z.object({
  amount: z.string().trim().regex(/^\d{1,8}(?:\.\d{1,2})?$/, 'Ingresa un monto válido con hasta dos decimales.'),
  concept: z.string().trim().min(1, 'Ingresa un concepto.').max(200, 'El concepto no puede superar 200 caracteres.'),
  category_id: z.string().min(1, 'Selecciona una categoría.'),
});

export type EditTransactionValues = z.infer<typeof editTransactionSchema>;

type EditTransactionModalProps = {
  amount: string;
  concept: string;
  categoryId: string;
  categories: CategoryChoice[];
  busy?: boolean;
  onClose: () => void;
  onSave: (values: EditTransactionValues) => void;
};

export function EditTransactionModal({ amount, concept, categoryId, categories, busy = false, onClose, onSave }: EditTransactionModalProps) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<EditTransactionValues>({
    resolver: zodResolver(editTransactionSchema),
    defaultValues: { amount, concept, category_id: categoryId },
  });
  const selectedCategoryId = watch('category_id');

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title" className="fixed bottom-0 z-[111] max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="edit-transaction-title" className="text-lg font-semibold text-ink-900">Editar transacción</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-700 hover:bg-bg disabled:opacity-50"><X aria-hidden="true" size={20} /></button>
        </div>
        <form onSubmit={handleSubmit(onSave)} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-ink-700">
            Monto
            <input {...register('amount')} type="text" inputMode="decimal" autoComplete="off" disabled={busy} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3 text-ink-900" />
            {errors.amount && <span role="alert" className="mt-1 block text-sm text-danger-600">{errors.amount.message}</span>}
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Concepto
            <input {...register('concept')} type="text" maxLength={200} disabled={busy} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3 text-ink-900" />
            {errors.concept && <span role="alert" className="mt-1 block text-sm text-danger-600">{errors.concept.message}</span>}
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Categoría
            <div role="group" aria-label="Elige una categoría" className="mt-2 flex flex-wrap gap-2">
              {categories.map((category) => {
                const selected = selectedCategoryId === category.id;
                return <button key={category.id} type="button" aria-pressed={selected} disabled={busy} onClick={() => setValue('category_id', category.id, { shouldDirty: true, shouldValidate: true })} className={`min-h-10 rounded-full border px-4 text-sm font-medium disabled:opacity-50 ${selected ? 'border-brand-600 bg-brand-100 text-brand-700' : 'border-ink-300 bg-white text-ink-700 hover:bg-bg'}`}>{category.name}</button>;
              })}
            </div>
            {errors.category_id && <span role="alert" className="mt-1 block text-sm text-danger-600">{errors.category_id.message}</span>}
          </label>
          <button type="submit" disabled={busy} className="min-h-11 w-full rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">Guardar cambios</button>
        </form>
      </section>
    </div>,
    document.body,
  );
}

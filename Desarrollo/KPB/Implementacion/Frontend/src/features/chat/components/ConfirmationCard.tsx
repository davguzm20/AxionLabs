import { useEffect, useState } from 'react';
import { Check, CheckCircle2, LoaderCircle, Pencil, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { getCategories } from '../../classification/services/classificationService';
import type { Category } from '../../classification/types/classification.types';

export type Transaction = {
  id: string;
  type: 'EXPENSE' | 'INCOME';
  amount: string;
  currency: string;
  concept: string;
  transaction_date: string;
  wallet_id: string;
  category: { id: string; name: string; icon: string; source?: string };
};

export type TransactionStatus = 'extracted' | 'confirmed';
type ConfirmationCardProps = {
  transaction: Transaction;
  walletName: string;
  status: TransactionStatus;
  isAccepting?: boolean;
  onAccept?: (transaction: Transaction) => void;
};
type TransactionUpdateResponse = { id: string; category: Transaction['category']; concept: string };

export function ConfirmationCard({ transaction, walletName, status, isAccepting = false, onAccept }: ConfirmationCardProps) {
  const [currentTransaction, setCurrentTransaction] = useState(transaction);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(transaction.category.id);
  const [editedConcept, setEditedConcept] = useState(transaction.concept);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const date = new Date(`${currentTransaction.transaction_date}T12:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });

  useEffect(() => {
    setCurrentTransaction(transaction);
    setSelectedCategoryId(transaction.category.id);
    setEditedConcept(transaction.concept);
  }, [transaction]);

  async function openCategoryEditor() {
    if (status !== 'extracted') return;
    setIsEditorOpen(true);
    setSelectedCategoryId(currentTransaction.category.id);
    setEditedConcept(currentTransaction.concept);
    setLoadingCategories(true);
    setError(null);
    try {
      const data = await getCategories();
      setCategories(data.filter((category) => category.type === currentTransaction.type));
    } catch {
      setError('No se pudieron cargar las categorías. Inténtalo nuevamente.');
    } finally {
      setLoadingCategories(false);
    }
  }

  async function saveCategory() {
    if (savingCategory || !editedConcept.trim()) return;
    const selectedCategory = categories.find(({ id }) => id === selectedCategoryId)
      ?? (selectedCategoryId === currentTransaction.category.id
        ? { ...currentTransaction.category, type: currentTransaction.type }
        : undefined);
    if (!selectedCategory) return;

    if (status === 'extracted') {
      setCurrentTransaction((current) => ({ ...current, concept: editedConcept.trim(), category: selectedCategory }));
      setIsEditorOpen(false);
      return;
    }

    setSavingCategory(true);
    setError(null);
    try {
      const updated = await api<TransactionUpdateResponse>(`/transactions/${encodeURIComponent(currentTransaction.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ concept: editedConcept.trim(), category_id: selectedCategoryId }),
      });
      setCurrentTransaction((current) => ({ ...current, concept: updated.concept, category: updated.category }));
      setIsEditorOpen(false);
      setSuccess(true);
    } catch {
      setError('No se pudo actualizar la categoría. Inténtalo nuevamente.');
    } finally {
      setSavingCategory(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <img src="/bot-feliz.png" alt="Bot feliz" className="mt-1 h-14 w-14 shrink-0 rounded-full object-cover" />
      <section aria-labelledby={`confirmation-${currentTransaction.id}`} className="min-w-0 max-w-[28rem] flex-1 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
        <h2 id={`confirmation-${currentTransaction.id}`} className="font-semibold text-ink-900">
          {status === 'extracted' ? 'Revisa tu transacción' : 'Transacción registrada'}
        </h2>
        <p className="mt-2 text-2xl font-bold text-brand-700">{currentTransaction.currency === 'PEN' ? 'S/' : '$'} {currentTransaction.amount}</p>
        <dl className="mt-3 space-y-1 text-sm text-ink-700">
          <div className="flex justify-between gap-4"><dt>Concepto</dt><dd className="text-right">{currentTransaction.concept}</dd></div>
          <div className="flex justify-between gap-4"><dt>Categoría</dt><dd className="text-right">{currentTransaction.category.name}</dd></div>
          <div className="flex justify-between gap-4"><dt>Monedero</dt><dd className="text-right">{walletName}</dd></div>
          <div className="flex justify-between gap-4"><dt>Fecha</dt><dd className="text-right">{date}</dd></div>
        </dl>
        {success && <p role="status" className="mt-3 flex items-center gap-2 text-sm font-medium text-green-700"><CheckCircle2 aria-hidden="true" size={18} /> Categoría actualizada.</p>}
        {status === 'extracted' ? (
          <div className="mt-4 flex w-full gap-2">
            <button type="button" onClick={() => onAccept?.(currentTransaction)} disabled={isAccepting} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">
              {isAccepting ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <CheckCircle2 aria-hidden="true" size={18} />}
              {isAccepting ? 'Guardando…' : 'Aceptar'}
            </button>
            <button type="button" onClick={() => void openCategoryEditor()} disabled={isAccepting} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-ink-300 px-3 text-sm font-medium text-ink-900 disabled:opacity-50">
              <Pencil aria-hidden="true" size={16} /> Editar
            </button>
          </div>
        ) : (
          <div className="mt-4 flex w-full gap-2">
            <Link to="/historial" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white">Ver historial</Link>
          </div>
        )}
      </section>
      {isEditorOpen && status === 'extracted' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingCategory && !isAccepting) setIsEditorOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby={`edit-category-title-${currentTransaction.id}`} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-lg sm:rounded-xl">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`edit-category-title-${currentTransaction.id}`} className="text-lg font-semibold text-ink-900">Editar categoría</h3>
              <button type="button" onClick={() => setIsEditorOpen(false)} disabled={savingCategory || isAccepting} aria-label="Cerrar" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-700 hover:bg-bg disabled:opacity-50"><X aria-hidden="true" size={20} /></button>
            </div>
            <p className="mt-1 text-sm text-ink-500">Actualiza el concepto o la categoría de esta transacción.</p>
            <label htmlFor={`edit-concept-${currentTransaction.id}`} className="mt-4 block text-sm font-medium text-ink-700">Concepto</label>
            <input
              id={`edit-concept-${currentTransaction.id}`}
              type="text"
              value={editedConcept}
              onChange={(event) => setEditedConcept(event.target.value)}
              maxLength={200}
              disabled={savingCategory || isAccepting}
              className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3 text-sm text-ink-900"
            />
            {loadingCategories ? (
              <p role="status" className="flex min-h-24 items-center justify-center gap-2 text-sm text-ink-500"><LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> Cargando categorías…</p>
            ) : (
              <div role="group" aria-label="Categorías disponibles" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {categories.map((category) => {
                  const selected = selectedCategoryId === category.id;
                  return (
                    <button key={category.id} type="button" aria-pressed={selected} disabled={savingCategory || isAccepting} onClick={() => { setSelectedCategoryId(category.id); setSuccess(false); }} className={`flex min-h-11 items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50 ${selected ? 'border-brand-600 bg-brand-100 font-semibold text-brand-700' : 'border-ink-300 text-ink-700 hover:bg-bg'}`}>
                      {category.name}{selected && <Check aria-hidden="true" size={18} />}
                    </button>
                  );
                })}
              </div>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-danger-600">{error}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setIsEditorOpen(false)} disabled={savingCategory || isAccepting} className="min-h-11 rounded-md border border-ink-300 px-4 text-sm font-medium text-ink-900 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={() => void saveCategory()} disabled={loadingCategories || savingCategory || isAccepting || !selectedCategoryId || !editedConcept.trim() || (selectedCategoryId === currentTransaction.category.id && editedConcept.trim() === currentTransaction.concept)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
                {savingCategory && <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />}
                {savingCategory ? 'Guardando…' : status === 'extracted' ? 'Usar cambios' : 'Guardar cambios'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

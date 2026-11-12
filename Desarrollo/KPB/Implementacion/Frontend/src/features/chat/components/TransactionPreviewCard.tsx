import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { EditTransactionModal, type EditTransactionValues } from './EditTransactionModal';
import { api } from '../../../lib/api';
import type { ApiCategoryChoice, CategoryChoice, TransactionDraft, TransactionPreview, WalletChoice } from '../transactionPreview.types';

type TransactionPreviewCardProps = {
  source: 'TEXT' | 'VOICE' | 'RECEIPT';
  preview: TransactionPreview;
  imageFile?: File;
  isSaving: boolean;
  saveError?: string;
  onEdit: (draft: TransactionDraft, category: CategoryChoice) => void;
  onConfirm: (draft: TransactionDraft) => void;
};

type ListResponse<T> = { data: T[] } | T[];

function responseItems<T>(response: ListResponse<T>): T[] {
  return Array.isArray(response) ? response : response.data;
}

function normalizeAmount(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().replace(',', '.').split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

function initialDraft(preview: TransactionPreview): TransactionDraft {
  const extracted = preview.extracted;
  return {
    type: extracted.type,
    amount: extracted.amount ?? '',
    currency: extracted.currency,
    concept: extracted.concept,
    transaction_date: extracted.transaction_date,
    category_id: extracted.category.id,
    wallet_id: extracted.wallet_id ?? preview.wallet_id ?? '',
    merchant: extracted.merchant ?? '',
    ruc: extracted.ruc ?? '',
  };
}

export function TransactionPreviewCard({
  source,
  preview,
  imageFile,
  isSaving,
  saveError,
  onEdit,
  onConfirm,
}: TransactionPreviewCardProps) {
  const [draft, setDraft] = useState(() => initialDraft(preview));
  const [categories, setCategories] = useState<CategoryChoice[]>([]);
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const titleId = 'preview-title-' + preview.preview_id;
  const categoryOptions = categories.filter((category) => category.type === draft.type && category.status !== 'INACTIVE');
  const previewCategory = preview.extracted.category;
  const hasPreviewCategory = categoryOptions.some((category) => category.id === previewCategory.id);
  const categoriesForSelect =
    hasPreviewCategory
    || previewCategory.status === 'INACTIVE'
    || (previewCategory.type && previewCategory.type !== draft.type)
      ? categoryOptions
      : [...categoryOptions, { ...previewCategory, type: previewCategory.type ?? draft.type }];
  const walletOptions = wallets.filter((wallet) => wallet.currency === draft.currency && wallet.status !== 'INACTIVE');
  const selectedCategoryAvailable = categoriesForSelect.some((category) => category.id === draft.category_id);
  const selectedWalletAvailable = walletOptions.some((wallet) => wallet.id === draft.wallet_id);
  const amountValue = Number(draft.amount.trim());
  const validAmount = /^\d{1,8}(?:\.\d{1,2})?$/.test(draft.amount.trim()) && Number.isFinite(amountValue) && amountValue > 0;

  useEffect(() => {
    let active = true;
    Promise.all([
      api<ListResponse<ApiCategoryChoice>>('/categories?status=ACTIVE'),
      api<ListResponse<WalletChoice>>('/wallets?status=ACTIVE'),
    ]).then(([categoryResponse, walletResponse]) => {
      if (!active) return;
      const categoryItems: CategoryChoice[] = responseItems(categoryResponse).map((category) => ({
        ...category,
        type: category.type.toUpperCase() as CategoryChoice['type'],
        icon: 'circle-help',
      }));
      const walletItems = responseItems(walletResponse);
      setCategories(categoryItems);
      setWallets(walletItems);
      setDraft((current) => {
        if (current.wallet_id || walletItems.length === 0) return current;
        const defaultWallet = walletItems.find((wallet) => wallet.is_default) ?? walletItems[0];
        if (!defaultWallet) return current;
        return { ...current, wallet_id: defaultWallet.id };
      });
    }).catch(() => {
      if (active) setOptionsError('No se pudieron cargar categorías o monederos. Inténtalo nuevamente.');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!imageFile) {
      setImageUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    setImageUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  function saveEdits(values: EditTransactionValues) {
    const updatedDraft: TransactionDraft = {
      ...draft,
      amount: normalizeAmount(values.amount),
      concept: values.concept.trim(),
      category_id: values.category_id,
    };
    setDraft(updatedDraft);
    onEdit(updatedDraft, categoriesForSelect.find(({ id }) => id === values.category_id) ?? previewCategory);
    setIsEditing(false);
  }

  return (
    <div className="flex items-start gap-4">
      <img src="/bot-sorprendido.png" alt="" className="relative z-0 mt-1 h-12 w-12 shrink-0 rounded-full object-cover sm:h-14 sm:w-14" />
      <section aria-labelledby={titleId} className="relative z-10 min-w-0 max-w-[34rem] flex-1 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
        <h2 id={titleId} className="font-semibold text-ink-900">
          {source === 'TEXT' ? 'Revisa tu transacción' : source === 'VOICE' ? 'Revisa la transacción por voz' : 'Revisa los datos del comprobante'}
        </h2>

        {preview.transcript && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3">
            <p className="text-xs font-medium text-ink-600">Texto transcrito</p>
            <p className="mt-1 text-sm text-ink-900">{preview.transcript}</p>
          </div>
        )}
        {imageUrl && (
          <img src={imageUrl} alt="Vista previa temporal del comprobante" className="mt-3 max-h-48 max-w-full rounded-lg border border-ink-300 object-contain" />
        )}
        {preview.ocr_text && (
          <details className="mt-3 rounded-lg bg-gray-50 p-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-700">Ver texto leído del comprobante</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-600">{preview.ocr_text}</pre>
          </details>
        )}

        <p className="mt-3 text-2xl font-bold text-brand-700">{draft.currency === 'PEN' ? 'S/' : '$'} {draft.amount}</p>
        <dl className="mt-3 space-y-2 text-sm text-ink-700">
          <div className="flex justify-between gap-4"><dt className="shrink-0">Concepto</dt><dd className="min-w-0 max-w-[70%] break-words text-right">{draft.concept}</dd></div>
          <div className="flex justify-between gap-4"><dt className="shrink-0">Categoría</dt><dd className="text-right">{categoriesForSelect.find(({ id }) => id === draft.category_id)?.name ?? previewCategory.name}</dd></div>
          <div className="flex justify-between gap-4"><dt className="shrink-0">Monedero</dt><dd className="text-right">{walletOptions.find(({ id }) => id === draft.wallet_id)?.name ?? 'Monedero'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="shrink-0">Fecha</dt><dd className="text-right">{new Date(`${draft.transaction_date}T12:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
        </dl>
        {optionsError && <p role="alert" className="mt-3 text-sm text-danger-600">{optionsError}</p>}
        {saveError && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-danger-700">{saveError}</p>}
        <div className="mt-4 flex w-full flex-row gap-2">
          <button type="button" onClick={() => setIsEditing(true)} disabled={isSaving} className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-ink-300 px-3 text-sm font-medium text-ink-900 disabled:opacity-50"><Pencil aria-hidden="true" size={16} />Editar</button>
          <button type="button" onClick={() => onConfirm(draft)} disabled={isSaving || !validAmount || !selectedCategoryAvailable || !selectedWalletAvailable} className="min-h-11 min-w-0 flex-1 rounded-md bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{isSaving ? 'Guardando…' : 'Aceptar'}</button>
        </div>
        {isEditing && <EditTransactionModal amount={draft.amount} concept={draft.concept} categoryId={draft.category_id} categories={categoriesForSelect} onClose={() => setIsEditing(false)} onSave={saveEdits} />}

      </section>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import type { CategoryChoice, TransactionDraft, TransactionPreview, WalletChoice } from '../transactionPreview.types';

type TransactionPreviewCardProps = {
  source: 'VOICE' | 'RECEIPT';
  preview: TransactionPreview;
  imageFile?: File;
  isSaving: boolean;
  saveError?: string;
  onConfirm: (draft: TransactionDraft) => void;
  onCancel: () => void;
};

type ListResponse<T> = { data: T[] };

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
  onConfirm,
  onCancel,
}: TransactionPreviewCardProps) {
  const [draft, setDraft] = useState(() => initialDraft(preview));
  const [categories, setCategories] = useState<CategoryChoice[]>([]);
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const titleId = 'preview-title-' + preview.preview_id;
  const categoryOptions = categories.filter((category) => category.type === draft.type && category.status !== 'INACTIVE');
  const previewCategory = preview.extracted.category;
  const hasPreviewCategory = categoryOptions.some((category) => category.id === previewCategory.id);
  const categoriesForSelect = hasPreviewCategory || (previewCategory.type && previewCategory.type !== draft.type)
    ? categoryOptions
    : [...categoryOptions, { ...previewCategory, type: previewCategory.type ?? draft.type }];
  const walletOptions = wallets.filter((wallet) => wallet.currency === draft.currency && wallet.status !== 'INACTIVE');
  const selectedCategoryAvailable = categoriesForSelect.some((category) => category.id === draft.category_id);
  const selectedWalletAvailable = walletOptions.some((wallet) => wallet.id === draft.wallet_id);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<ListResponse<CategoryChoice>>('/categories?status=ACTIVE'),
      api<ListResponse<WalletChoice>>('/wallets?status=ACTIVE'),
    ]).then(([categoryResponse, walletResponse]) => {
      if (!active) return;
      setCategories(categoryResponse.data);
      setWallets(walletResponse.data);
      setDraft((current) => {
        if (current.wallet_id || walletResponse.data.length === 0) return current;
        const defaultWallet = walletResponse.data.find((wallet) => wallet.is_default) ?? walletResponse.data[0];
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

  function update<K extends keyof TransactionDraft>(key: K, value: TransactionDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.wallet_id || !draft.category_id || !draft.amount || !draft.concept.trim()) return;
    onConfirm({
      ...draft,
      amount: Number(draft.amount).toFixed(2),
      concept: draft.concept.trim(),
      merchant: draft.merchant?.trim() || null,
      ruc: draft.ruc?.trim() || null,
    });
  }

  return (
    <div className="flex items-start gap-3">
      <img src="/bot-sorprendido.png" alt="" className="mt-1 h-14 w-14 shrink-0 rounded-full object-cover" />
      <section aria-labelledby={titleId} className="min-w-0 max-w-[34rem] flex-1 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
        <h2 id={titleId} className="font-semibold text-ink-900">
          {source === 'VOICE' ? 'Revisa la transacción por voz' : 'Revisa los datos del comprobante'}
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

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-ink-700">
              Tipo
              <select value={draft.type} onChange={(event) => {
                const type = event.target.value as TransactionDraft['type'];
                setDraft((current) => ({ ...current, type, category_id: '' }));
              }} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3">
                <option value="EXPENSE">Gasto</option>
                <option value="INCOME">Ingreso</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-ink-700">
              Monto
              <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={draft.amount} onChange={(event) => update('amount', event.target.value)} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3" />
            </label>
            <label className="block text-sm font-medium text-ink-700">
              Moneda
              <select value={draft.currency} onChange={(event) => {
                const currency = event.target.value;
                setDraft((current) => {
                  const matchingWallets = wallets.filter((wallet) => wallet.currency === currency && wallet.status !== 'INACTIVE');
                  if (matchingWallets.some((wallet) => wallet.id === current.wallet_id)) return { ...current, currency };
                  const defaultWallet = matchingWallets.find((wallet) => wallet.is_default) ?? matchingWallets[0];
                  return { ...current, currency, wallet_id: defaultWallet?.id ?? '' };
                });
              }} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3">
                <option value="PEN">Soles (PEN)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-ink-700">
              Fecha
              <input type="date" required value={draft.transaction_date} onChange={(event) => update('transaction_date', event.target.value)} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3" />
            </label>
          </div>

          <label className="block text-sm font-medium text-ink-700">
            Concepto
            <input type="text" required maxLength={200} value={draft.concept} onChange={(event) => update('concept', event.target.value)} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3" />
          </label>

          {source === 'RECEIPT' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-ink-700">
                Comercio
                <input type="text" maxLength={200} value={draft.merchant ?? ''} onChange={(event) => update('merchant', event.target.value)} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3" />
              </label>
              <label className="block text-sm font-medium text-ink-700">
                RUC
                <input type="text" inputMode="numeric" pattern="[0-9]{11}" title="El RUC debe tener 11 dígitos." maxLength={11} value={draft.ruc ?? ''} onChange={(event) => update('ruc', event.target.value)} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 px-3" />
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-ink-700">
              Categoría
              <select required value={draft.category_id} onChange={(event) => update('category_id', event.target.value)} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3">
                <option value="">Selecciona una categoría</option>
                {categoriesForSelect.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-ink-700">
              Monedero
              <select required value={draft.wallet_id} onChange={(event) => update('wallet_id', event.target.value)} disabled={isSaving} className="mt-1 min-h-11 w-full rounded-md border border-ink-300 bg-white px-3">
                <option value="">Selecciona un monedero</option>
                {walletOptions.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.currency}</option>)}
              </select>
            </label>
          </div>

          {categoriesForSelect.length === 0 && <p className="text-sm text-danger-600">No hay categorías activas disponibles para este tipo.</p>}
          {walletOptions.length === 0 && <p className="text-sm text-danger-600">No hay monederos activos en {draft.currency}.</p>}
          {optionsError && <p role="alert" className="text-sm text-danger-600">{optionsError}</p>}
          {saveError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-danger-700">{saveError}</p>}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" onClick={onCancel} disabled={isSaving} className="min-h-11 rounded-md border border-ink-300 px-4 text-sm font-medium text-ink-900 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={isSaving || !selectedCategoryAvailable || !selectedWalletAvailable} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving && <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />}
              {isSaving ? 'Guardando…' : 'Confirmar y guardar'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

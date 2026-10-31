import { CheckCircle, LoaderCircle, RotateCw } from 'lucide-react';
import { CategorySelector } from '../components/CategorySelector';
import { TransactionSummary } from '../components/TransactionSummary';
import { useClassification } from '../hooks/useClassification';

function ClassificationSkeleton() {
  return (
    <div role="status" aria-label="Cargando sugerencia de categoría" className="animate-pulse space-y-4">
      <span className="sr-only">Cargando transacción y categorías…</span>
      <div className="h-36 rounded-xl bg-ink-300/50" />
      <div className="h-40 rounded-xl bg-ink-300/50" />
      <div className="h-11 w-full rounded-md bg-ink-300/50 sm:w-48" />
    </div>
  );
}

export function ClassificationPage() {
  const {
    categories,
    transaction,
    selectedCategory,
    classification,
    loading,
    error,
    saved,
    selectCategory,
    confirmCategory,
    retry,
  } = useClassification();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-24 sm:px-6 lg:py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">KhipuBot</p>
        <h1 className="mt-1 text-h1 text-ink-900">Clasificar transacción</h1>
        <p className="mt-2 text-sm text-ink-500">Revisa la categoría sugerida para tu movimiento.</p>
      </header>

      {loading ? <ClassificationSkeleton /> : error ? (
        <section role="alert" className="rounded-xl border border-danger-500 bg-white p-5">
          <p className="text-sm text-ink-900">{error}</p>
          <button type="button" onClick={retry} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
            <RotateCw aria-hidden="true" size={18} /> Reintentar
          </button>
        </section>
      ) : (
        <div className="space-y-4">
          <TransactionSummary transaction={transaction} />
          <CategorySelector
            categories={categories}
            selectedCategory={selectedCategory}
            suggestedCategory={classification?.category ?? null}
            onSelect={selectCategory}
          />
          {classification?.needs_review && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-ink-700">
              No encontramos una coincidencia clara. Revisa la categoría antes de continuar.
            </p>
          )}
          {saved ? (
            <div role="status" className="flex items-center gap-2 rounded-lg bg-green-50 p-4 font-medium text-green-800">
              <CheckCircle aria-hidden="true" size={22} /> Categoría confirmada: {selectedCategory?.name}
            </div>
          ) : (
            <button
              type="button"
              onClick={confirmCategory}
              disabled={!selectedCategory}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <CheckCircle aria-hidden="true" size={18} />}
              Confirmar categoría
            </button>
          )}
        </div>
      )}
    </main>
  );
}

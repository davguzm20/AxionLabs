import { ChevronLeft, Info, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BudgetCard } from '../components/BudgetCard';
import { BudgetFormModal, type BudgetFormValues } from '../components/BudgetFormModal';
import { useBudgets } from '../hooks/useBudgets';
import type { Budget } from '../types/budget.types';

export function BudgetsPage() {
  const navigate = useNavigate();
  const { budgets, categories, period, loading, saving, error, reload, save, clearError } = useBudgets();
  const [formOpen, setFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [showInfo, setShowInfo] = useState(true);

  const openForm = (budget: Budget | null = null) => {
    clearError();
    setEditingBudget(budget);
    setFormOpen(true);
  };

  const submit = async (values: BudgetFormValues) => {
    await save(values.category_id, values.monthly_limit, values.alert_threshold);
    setFormOpen(false);
    setEditingBudget(null);
  };

  return (
    <>
      <main className="h-full w-full overflow-y-auto bg-white px-4 pb-24 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">
          <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-[4.5rem] items-center gap-3 border-b border-gray-200 bg-white px-4 sm:-mx-6 sm:px-6">
            <button type="button" aria-label="Volver a Ajustes" onClick={() => navigate('/ajustes')} className="flex size-10 shrink-0 items-center justify-center rounded-md text-ink-700 hover:bg-bg">
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
            <div>
              <h1 className="font-semibold text-ink-900">Presupuestos</h1>
            </div>
          </header>

          {showInfo && <aside className="mb-6 flex items-start gap-3 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
            <Info aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600" size={20} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900">¿Cómo funciona un presupuesto?</p>
              <p className="mt-1 text-sm leading-6 text-gray-600">Define un tope para controlar tus gastos por categoría.</p>
            </div>
            <button type="button" aria-label="Cerrar información" onClick={() => setShowInfo(false)} className="flex size-9 items-center justify-center rounded-md text-ink-700 hover:bg-bg"><X aria-hidden="true" size={18} /></button>
          </aside>}

          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-500">{period}</p>
            <p className="text-right text-xs text-gray-500">Se reinicia el 1 de octubre</p>
          </div>

          {loading ? <div role="status" className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl bg-gray-200" />)}</div>
            : error ? <section role="alert" className="rounded-xl border border-danger bg-white p-5"><p className="text-sm text-danger-600">{error}</p><button type="button" onClick={() => void reload()} className="mt-3 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">Reintentar</button></section>
              : budgets.length === 0 ? <p className="rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center text-sm text-ink-500">Aún no tienes presupuestos.</p>
                : <section aria-label="Lista de presupuestos">{budgets.map((budget) => <BudgetCard key={budget.category_id} budget={budget} onEdit={(item) => openForm(item)} />)}</section>}

          <button type="button" onClick={() => openForm()} className="mt-6 mb-8 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
            Nuevo presupuesto
          </button>
        </div>
      </main>
      {formOpen && <BudgetFormModal categories={categories} budget={editingBudget} saving={saving} onClose={() => setFormOpen(false)} onSubmit={submit} />}
    </>
  );
}

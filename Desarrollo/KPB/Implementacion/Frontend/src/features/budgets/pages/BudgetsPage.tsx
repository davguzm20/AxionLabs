import { ArrowLeft, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BudgetCard } from '../components/BudgetCard';
import { DeactivateBudgetModal } from '../components/DeactivateBudgetModal';
import { useBudgets } from '../hooks/useBudgets';
import type { Budget } from '../types/budget.types';
import { Toast } from '../../../components/ui/Toast';
import { NotificationBell } from '../../cu08/components/NotificationBell';

function getCurrentMonthLabel(): string {
  return new Intl.DateTimeFormat('es-PE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(new Date());
}

export function BudgetsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [showInfo, setShowInfo] = useState(true);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [budgetToDeactivate, setBudgetToDeactivate] = useState<Budget | null>(null);
  const {
    budgets,
    isLoading,
    error,
    refetch,
    deactivate,
    isDeactivating,
    reactivate,
    isReactivating,
  } = useBudgets(status);
  const busy = isDeactivating || isReactivating;

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(undefined), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function handleDeactivate(budget: Budget) {
    setActionError(undefined);
    setNotice(undefined);
    setBudgetToDeactivate(budget);
  }

  async function confirmDeactivate() {
    if (!budgetToDeactivate) return;
    try {
      await deactivate(budgetToDeactivate.id);
      setBudgetToDeactivate(null);
      setNotice('Presupuesto desactivado.');
    } catch (cause) {
      setBudgetToDeactivate(null);
      setActionError(cause instanceof Error ? cause.message : 'No se pudo desactivar el presupuesto.');
    }
  }

  async function handleReactivate(budget: Budget) {
    setActionError(undefined);
    setNotice(undefined);
    try {
      await reactivate(budget.id);
      setNotice('Presupuesto reactivado.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo reactivar el presupuesto.');
    }
  }

  return (
    <main className="h-full min-w-0 w-full max-w-full overflow-x-hidden overflow-y-auto bg-bg px-4 pb-24 sm:px-6">
      <div className="mx-auto w-full min-w-0 max-w-6xl">
        <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-[4.5rem] min-w-0 items-center justify-between border-b border-ink-300 bg-white px-4 sm:-mx-6 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" aria-label="Volver a la página anterior" onClick={() => navigate(-1)} className="flex size-11 shrink-0 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-bg">
              <ArrowLeft aria-hidden="true" size={24} />
            </button>
            <h1 className="truncate text-lg font-semibold text-ink-900">Presupuestos y alertas</h1>
          </div>
          <NotificationBell />
        </header>

        {showInfo && (
          <aside className="mb-5 flex items-start gap-3 rounded-xl bg-white p-3.5">
            <Info aria-hidden="true" className="mt-0.5 shrink-0 text-ink-600" size={20} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-5 text-ink-900">¿Cómo funciona un presupuesto?</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-600">Es un sobre con tope: defines lo máximo que quieres gastar y KhipuBot te avisa al llegar al umbral. No guarda dinero ni está ligado a tus cuentas.</p>
            </div>
            <button type="button" aria-label="Cerrar información" onClick={() => setShowInfo(false)} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-bg">
              <X aria-hidden="true" size={18} />
            </button>
          </aside>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium capitalize text-ink-900">{getCurrentMonthLabel()}</h2>
            <p className="text-xs text-ink-500">El consumo se reinicia al comenzar cada periodo.</p>
          </div>
          <div className="flex max-w-full rounded-xl bg-gray-100 p-1" aria-label="Filtrar presupuestos">
            {(['ACTIVE', 'INACTIVE'] as const).map((value) => {
              const selected = status === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setStatus(value);
                    setActionError(undefined);
                    setNotice(undefined);
                  }}
                  className={`min-h-10 rounded-lg px-3 text-sm font-medium transition-colors ${selected ? 'bg-white text-brand-700 shadow-sm' : 'bg-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  {value === 'ACTIVE' ? 'Activos' : 'Inactivos'}
                </button>
              );
            })}
          </div>
        </div>

        {notice && <div className="fixed right-4 top-4 z-[120] w-[min(24rem,calc(100vw-2rem))]"><Toast message={notice} /></div>}
        {(actionError || error) && (
          <section role="alert" className="mb-4 rounded-xl border border-danger bg-white p-4">
            <p className="text-sm text-danger-600">{actionError ?? (error instanceof Error ? error.message : 'No se pudieron cargar los presupuestos.')}</p>
            <button type="button" onClick={() => { setActionError(undefined); void refetch(); }} className="mt-2 min-h-11 rounded-md px-2 text-sm font-medium text-accent-600 underline">Reintentar</button>
          </section>
        )}

        {isLoading ? (
          <div role="status" aria-label="Cargando presupuestos" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl bg-white" />)}
          </div>
        ) : budgets.length === 0 ? (
          <section className="rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
            <p className="text-sm text-ink-700">{status === 'ACTIVE' ? 'Aún no tienes presupuestos. Crea uno para controlar tus gastos.' : 'No tienes presupuestos inactivos.'}</p>
          </section>
        ) : (
          <section aria-label="Lista de presupuestos" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {budgets.map((budget) => (
              <BudgetCard key={budget.id} budget={budget} busy={busy}
                onEdit={(item) => navigate(`/presupuestos/${encodeURIComponent(item.id)}/editar`)}
                onDeactivate={handleDeactivate}
                onReactivate={(item) => void handleReactivate(item)}
              />
            ))}
          </section>
        )}

        <button type="button" onClick={() => navigate('/presupuestos/nuevo')} className="mb-8 mt-6 min-h-11 w-full rounded-xl bg-accent-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-accent-500">
          Nuevo presupuesto
        </button>
      </div>
      {budgetToDeactivate && <DeactivateBudgetModal budget={budgetToDeactivate} busy={isDeactivating} onCancel={() => setBudgetToDeactivate(null)} onConfirm={() => void confirmDeactivate()} />}
    </main>
  );
}

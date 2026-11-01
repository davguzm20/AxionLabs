import { ArrowLeft, Info, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BudgetCard } from '../components/BudgetCard';
import { useBudgets } from '../hooks/useBudgets';
import type { Budget } from '../types/budget.types';

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

  async function handleDeactivate(budget: Budget) {
    if (!window.confirm('¿Desactivar presupuesto?')) return;

    setActionError(undefined);
    setNotice(undefined);
    try {
      await deactivate(budget.id);
      setNotice('Presupuesto desactivado.');
    } catch (cause) {
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
    <main className="h-full w-full overflow-y-auto bg-bg px-4 pb-24 sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-[4.5rem] items-center gap-3 border-b border-ink-300 bg-white px-4 sm:-mx-6 sm:px-6">
          <button
            type="button"
            aria-label="Volver a Ajustes"
            onClick={() => navigate('/ajustes')}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-bg"
          >
            <ArrowLeft aria-hidden="true" size={20} />
          </button>
          <h1 className="font-semibold text-ink-900">Presupuestos y alertas</h1>
        </header>

        {showInfo && (
          <aside className="mb-5 flex items-start gap-3 rounded-xl bg-white p-3.5">
            <Info aria-hidden="true" className="mt-0.5 shrink-0 text-ink-600" size={20} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-5 text-ink-900">¿Cómo funciona un presupuesto?</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
                Es un sobre con tope: defines lo máximo que quieres gastar y KhipuBot te avisa al llegar al umbral. No guarda dinero ni está ligado a tus cuentas.
              </p>
            </div>
            <button
              type="button"
              aria-label="Cerrar información"
              onClick={() => setShowInfo(false)}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-bg"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </aside>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium capitalize text-ink-900">{getCurrentMonthLabel()}</h2>
            <p className="text-xs text-ink-500">El consumo se reinicia al comenzar cada periodo.</p>
          </div>
          <div className="flex rounded-lg bg-white p-1" aria-label="Filtrar presupuestos">
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
                  className={`min-h-10 rounded-md px-3 text-sm font-medium ${selected ? 'bg-accent-600 text-white' : 'text-ink-700 hover:bg-bg'}`}
                >
                  {value === 'ACTIVE' ? 'Activos' : 'Inactivos'}
                </button>
              );
            })}
          </div>
        </div>

        {notice && <p role="status" className="mb-3 rounded-md bg-white p-3 text-sm text-success">{notice}</p>}
        {(actionError || error) && (
          <section role="alert" className="mb-4 rounded-xl border border-danger bg-white p-4">
            <p className="text-sm text-danger-600">{actionError ?? (error instanceof Error ? error.message : 'No se pudieron cargar los presupuestos.')}</p>
            <button
              type="button"
              onClick={() => {
                setActionError(undefined);
                void refetch();
              }}
              className="mt-2 min-h-11 rounded-md px-2 text-sm font-medium text-accent-600 underline"
            >
              Reintentar
            </button>
          </section>
        )}

        {isLoading ? (
          <div role="status" aria-label="Cargando presupuestos" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl bg-white" />)}
          </div>
        ) : budgets.length === 0 ? (
          <section className="rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
            <p className="text-sm text-ink-700">
              {status === 'ACTIVE'
                ? 'Aún no tienes presupuestos. Crea uno para controlar tus gastos.'
                : 'No tienes presupuestos inactivos.'}
            </p>
          </section>
        ) : (
          <section aria-label="Lista de presupuestos" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {budgets.map((budget) => (
              <BudgetCard
                key={budget.id}
                budget={budget}
                busy={busy}
                onEdit={(item) => navigate(`/presupuestos/${encodeURIComponent(item.id)}/editar`)}
                onDeactivate={(item) => void handleDeactivate(item)}
                onReactivate={(item) => void handleReactivate(item)}
              />
            ))}
          </section>
        )}

        <button
          type="button"
          onClick={() => navigate('/presupuestos/nuevo')}
          className="mt-6 mb-8 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-accent-500"
        >
          <Plus aria-hidden="true" size={18} />
          Nuevo presupuesto
        </button>
      </div>
    </main>
  );
}

import { AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Budget } from '../types/budget.types';

interface DeactivateBudgetModalProps {
  budget: Budget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeactivateBudgetModal({ budget, busy, onCancel, onConfirm }: DeactivateBudgetModalProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="deactivate-budget-title" aria-describedby="deactivate-budget-description" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle aria-hidden="true" size={22} />
        </div>
        <h2 id="deactivate-budget-title" className="text-lg font-bold text-gray-900">¿Desactivar presupuesto?</h2>
        <p id="deactivate-budget-description" className="mt-2 text-sm text-gray-500">
          El presupuesto de {budget.category.name} dejará de monitorearse. Podrás reactivarlo después desde la pestaña de Inactivos.
        </p>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 rounded-xl border border-gray-300 bg-white py-2.5 font-medium text-gray-700 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="flex-1 rounded-xl bg-red-600 py-2.5 font-medium text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60">
            {busy ? 'Desactivando…' : 'Desactivar'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

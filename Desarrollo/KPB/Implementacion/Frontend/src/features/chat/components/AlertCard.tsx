import { useId } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { BudgetAlert, LegacyBudgetAlert } from '../transactionPreview.types';

export type { BudgetAlert } from '../transactionPreview.types';
export type ChatAlert = BudgetAlert | LegacyBudgetAlert;

type AlertCardProps = { alert: ChatAlert };

export function AlertCard({ alert }: AlertCardProps) {
  const titleId = useId();
  const message = alert.message;
  const isDanger = alert.priority
    ? alert.priority.toLocaleLowerCase() === 'high'
    : ('severity' in alert && alert.severity === 'danger') || /excediste|superaste|excedido/i.test(message);
  const colorClass = isDanger
    ? 'border-red-500 bg-white text-red-600'
    : 'border-warning-500 bg-white text-warning-600';

  return (
    <div className="flex items-start gap-3">
      <img
        src={isDanger ? '/bot-triste.png' : '/bot-sorprendido.png'}
        alt={isDanger ? 'Bot triste' : 'Bot sorprendido'}
        className="mt-1 h-14 w-14 shrink-0 rounded-full object-cover"
      />
      <section aria-labelledby={titleId} className={`min-w-0 flex-1 rounded-xl border-2 p-4 shadow-sm ${colorClass}`}>
        <div className="flex items-start gap-2">
          {isDanger
            ? <XCircle aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
            : <AlertTriangle aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />}
          <div>
            <h2 id={titleId} className="font-semibold">{isDanger ? '¡Presupuesto excedido!' : 'Alerta de presupuesto'}</h2>
            <p className="mt-1 text-sm leading-5 text-ink-900">{message}</p>
          </div>
        </div>
        <Link to="/presupuestos" className={`mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border px-3 text-sm font-medium ${colorClass}`}>
          Ver presupuesto
        </Link>
      </section>
    </div>
  );
}

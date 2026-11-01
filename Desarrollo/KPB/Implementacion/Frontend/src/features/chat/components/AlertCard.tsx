import { useId } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export type BudgetAlert = {
  id?: string;
  title?: string;
  message?: string;
  body?: string;
  severity?: string;
  priority?: 'high' | 'normal' | 'HIGH' | 'NORMAL';
  threshold_percentage?: number;
  usage_percentage?: number;
};

type AlertCardProps = { alert: BudgetAlert };

export function AlertCard({ alert }: AlertCardProps) {
  const titleId = useId();
  const message = alert.message ?? alert.body ?? 'Se alcanzó un umbral de tu presupuesto.';
  const isDanger = alert.priority
    ? alert.priority.toLocaleLowerCase() === 'high'
    : alert.severity === 'danger' || /excediste|superaste|excedido/i.test(message);
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
            <h2 id={titleId} className="font-semibold">{alert.title ?? (isDanger ? 'Presupuesto superado' : 'Alerta de presupuesto')}</h2>
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

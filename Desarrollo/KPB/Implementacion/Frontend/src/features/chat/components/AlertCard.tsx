import { useId } from 'react';
import { Link } from 'react-router-dom';

export type BudgetAlert = {
  message: string;
  severity?: string;
};

type AlertCardProps = { alert: BudgetAlert };

export function AlertCard({ alert }: AlertCardProps) {
  const titleId = useId();
  const isDanger = alert.severity === 'danger' || /excediste|superaste|excedido/i.test(alert.message);
  const colorClass = isDanger ? 'border-danger-500 text-danger-600' : 'border-warning-500 text-warning-600';

  return (
    <div className="flex items-start gap-3">
      <img
        src={isDanger ? '/bot-triste.png' : '/bot-sorprendido.png'}
        alt={isDanger ? 'Bot triste' : 'Bot sorprendido'}
        className="mt-1 h-14 w-14 shrink-0 rounded-full object-cover"
      />
      <section aria-labelledby={titleId} className={`min-w-0 flex-1 rounded-xl border-2 bg-white p-4 shadow-sm ${colorClass}`}>
        <div className="flex items-start gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 h-6 w-6 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5 2.8 19.2a1.5 1.5 0 0 0 1.3 2.3h15.8a1.5 1.5 0 0 0 1.3-2.3L12 3.5Z" />
            <path strokeLinecap="round" d="M12 9v5" />
            <path strokeLinecap="round" strokeWidth="2.4" d="M12 17.5h.01" />
          </svg>
          <div>
            <h2 id={titleId} className="font-semibold">Alerta de presupuesto</h2>
            <p className="mt-1 text-sm leading-5 text-ink-900">{alert.message}</p>
          </div>
        </div>
        <Link to="/presupuestos" className={`mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border px-3 text-sm font-medium ${colorClass}`}>
          Ver presupuesto
        </Link>
      </section>
    </div>
  );
}

import { Link } from 'react-router-dom';

export type Transaction = {
  id: string;
  type: 'EXPENSE' | 'INCOME';
  amount: string;
  currency: string;
  concept: string;
  transaction_date: string;
  wallet_id: string;
  category: { id: string; name: string; icon: string };
};

type ConfirmationCardProps = { transaction: Transaction; walletName: string };

export function ConfirmationCard({ transaction, walletName }: ConfirmationCardProps) {
  const amount = transaction.amount;
  const date = new Date(`${transaction.transaction_date}T12:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  return (
    <div className="flex items-start gap-3">
      <img src="/bot-feliz.png" alt="Bot feliz" className="mt-1 h-14 w-14 shrink-0 rounded-full object-cover" />
      <section aria-labelledby={`confirmation-${transaction.id}`} className="min-w-0 max-w-[28rem] flex-1 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
        <h2 id={`confirmation-${transaction.id}`} className="font-semibold text-ink-900">Registré tu transacción</h2>
        <p className="mt-2 text-2xl font-bold text-brand-700">{transaction.currency === 'PEN' ? 'S/' : '$'} {amount}</p>
        <dl className="mt-3 space-y-1 text-sm text-ink-700">
          <div className="flex justify-between gap-4"><dt>Concepto</dt><dd className="text-right">{transaction.concept}</dd></div>
          <div className="flex justify-between gap-4"><dt>Categoría</dt><dd className="text-right">{transaction.category.name}</dd></div>
          <div className="flex justify-between gap-4"><dt>Monedero</dt><dd className="text-right">{walletName}</dd></div>
          <div className="flex justify-between gap-4"><dt>Fecha</dt><dd className="text-right">{date}</dd></div>
        </dl>
        <div className="mt-4 flex w-full gap-2">
          <button type="button" className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-ink-300 px-3 text-sm font-medium text-ink-900">Editar categoría</button>
          <Link to="/historial" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-brand-600 px-3 text-sm font-medium text-white">Ver historial</Link>
        </div>
      </section>
    </div>
  );
}

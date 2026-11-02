import { ReceiptText } from 'lucide-react';
import type { Transaction } from '../types/classification.types';

interface TransactionSummaryProps {
  transaction: Transaction;
}

export function TransactionSummary({ transaction }: TransactionSummaryProps) {
  const amountPrefix = transaction.currency === 'PEN' ? 'S/' : transaction.currency;

  return (
    <section aria-labelledby="transaction-summary-title" className="rounded-xl border border-ink-300 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
        <ReceiptText aria-hidden="true" size={20} />
        <h2 id="transaction-summary-title">Transacción detectada</h2>
      </div>
      <p className="mt-4 text-3xl font-bold text-brand-700" aria-label={`Monto: ${amountPrefix} ${transaction.amount}`}>
        {amountPrefix} {transaction.amount}
      </p>
      <p className="mt-1 break-words text-base text-ink-900">{transaction.concept}</p>
    </section>
  );
}

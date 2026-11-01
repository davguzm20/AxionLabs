import { Banknote, Landmark } from 'lucide-react';
import type { Wallet } from '../types/wallet.types';

interface WalletCardProps {
  wallet: Wallet;
}

function formatBalance(balance: string, currency: string): string {
  const symbol = currency === 'PEN' ? 'S/' : currency;
  return `${symbol} ${balance}`;
}

export function WalletCard({ wallet }: WalletCardProps) {
  const Icon = wallet.type === 'bank' ? Landmark : Banknote;
  return (
    <article className="mb-4 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-bg text-ink-700">
            <Icon aria-hidden="true" size={22} />
          </span>

          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink-900">
              {wallet.name}
            </h2>

            {wallet.is_default && (
              <span className="mt-1 inline-flex rounded-md bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                Predeterminado
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 pt-2">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
          Saldo actual
        </p>

        <p className="mt-1 text-lg font-bold tabular-nums text-ink-900">
          {formatBalance(wallet.balance, wallet.currency)}
        </p>
      </div>
    </article>
  );
}

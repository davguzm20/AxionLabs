import { Banknote, EllipsisVertical, Landmark, LoaderCircle, Pencil } from 'lucide-react';
import { useRef } from 'react';
import type { Wallet } from '../types/wallet.types';

interface WalletCardProps {
  wallet: Wallet;
  busy?: boolean;
  onEdit: (wallet: Wallet) => void;
  onMarkDefault: (wallet: Wallet) => void;
  onDeactivate: (wallet: Wallet) => void;
  onReactivate: (wallet: Wallet) => void;
}

function formatBalance(balance: string, currency: string): string {
  const symbol = currency === 'PEN' ? 'S/' : currency === 'USD' ? '$' : currency;
  const isNegative = balance.startsWith('-');
  const amount = (isNegative ? balance.slice(1) : balance).split('.');
  const whole = Number(amount[0] || '0').toLocaleString('es-PE');
  const fraction = (amount[1] ?? '00').padEnd(2, '0').slice(0, 2);
  return `${isNegative ? '-' : ''}${symbol} ${whole}.${fraction}`;
}

export function WalletCard({ wallet, busy = false, onEdit, onMarkDefault, onDeactivate, onReactivate }: WalletCardProps) {
  const Icon = wallet.type === 'bank' ? Landmark : Banknote;
  const inactive = wallet.status === 'INACTIVE';
  const negativeBalance = wallet.balance.startsWith('-');
  const menuRef = useRef<HTMLDetailsElement>(null);

  function runMenuAction(action: (item: Wallet) => void) {
    menuRef.current?.removeAttribute('open');
    action(wallet);
  }

  return (
    <article aria-labelledby={`wallet-name-${wallet.id}`} aria-busy={busy} className={`relative rounded-xl border border-ink-300 bg-white p-4 shadow-sm ${inactive ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-bg text-ink-700">
            <Icon aria-hidden="true" size={22} />
          </span>
          <div className="min-w-0">
            <h2 id={`wallet-name-${wallet.id}`} className="truncate text-base font-semibold text-ink-900">{wallet.name}</h2>
            <p className="mt-0.5 text-xs text-ink-500">{wallet.type === 'bank' ? 'Banco' : 'Efectivo'} · {wallet.currency}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {wallet.is_default && !inactive && <span className="inline-flex rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-600">Predeterminado</span>}
              {inactive && <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-ink-700">Inactivo</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button type="button" disabled={busy} onClick={() => onEdit(wallet)} aria-label={`Editar ${wallet.name}`} className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-accent-600 hover:bg-accent-100 disabled:opacity-50">
            <Pencil aria-hidden="true" size={20} />
          </button>
          <details ref={menuRef} className="relative">
            <summary aria-label={`Acciones para ${wallet.name}`} aria-haspopup="menu" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md text-ink-600 hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 [&::-webkit-details-marker]:hidden">
              {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={20} /> : <EllipsisVertical aria-hidden="true" size={20} />}
            </summary>
            <div role="menu" aria-label={`Acciones para ${wallet.name}`} className="absolute right-0 top-11 z-10 min-w-48 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
              {!inactive && !wallet.is_default && <button type="button" role="menuitem" disabled={busy} onClick={() => runMenuAction(onMarkDefault)} className="min-h-11 w-full px-3 text-left text-sm text-ink-700 hover:bg-bg disabled:opacity-50">Marcar como predeterminado</button>}
              {inactive
                ? <button type="button" role="menuitem" disabled={busy} onClick={() => runMenuAction(onReactivate)} className="min-h-11 w-full px-3 text-left text-sm text-ink-700 hover:bg-bg disabled:opacity-50">Reactivar</button>
                : <button type="button" role="menuitem" disabled={busy} onClick={() => runMenuAction(onDeactivate)} className="min-h-11 w-full px-3 text-left text-sm text-danger-600 hover:bg-red-50 disabled:opacity-50">Desactivar</button>}
            </div>
          </details>
        </div>
      </div>

      <div className="mt-4 border-t border-ink-100 pt-3">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-500">Saldo actual</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${negativeBalance ? 'text-danger-600' : 'text-ink-900'}`}>{formatBalance(wallet.balance, wallet.currency)}</p>
        {negativeBalance && <p className="mt-1 text-xs font-medium text-danger-600">Saldo negativo</p>}
      </div>
    </article>
  );
}

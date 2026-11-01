import { Info, RotateCw, Wallet as WalletIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useNotificationPreferences } from '../../notifications/hooks/useNotificationPreferences';
import { WalletCard } from '../components/WalletCard';
import { useWallets } from '../hooks/useWallets';
import type { Wallet } from '../types/wallet.types';

function cents(value: string): bigint {
  const match = value.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const amount = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -amount : amount;
}

function formatCents(value: bigint, currency: string): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const symbol = currency === 'PEN' ? 'S/' : '$';
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${symbol} ${whole}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function WalletsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { wallets, loading, savingWalletId, loadError, actionError, reload, clearError, markDefault, deactivate, reactivate } = useWallets();
  const { preferences } = useNotificationPreferences();
  const [showInfo, setShowInfo] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const mainCurrency = preferences?.main_currency ?? 'PEN';
  const total = wallets
    .filter((wallet) => wallet.currency === mainCurrency && (wallet.status ?? 'ACTIVE') === 'ACTIVE')
    .reduce((sum, wallet) => sum + cents(wallet.balance), 0n);
  const activeWallets = wallets.filter((wallet) => (wallet.status ?? 'ACTIVE') === 'ACTIVE');
  const inactiveWallets = wallets.filter((wallet) => wallet.status === 'INACTIVE');

  useEffect(() => {
    const message = (location.state as { walletMessage?: string } | null)?.walletMessage;
    if (message) {
      setSuccessMessage(message);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  async function chooseDefault(wallet: Wallet) {
    setSuccessMessage(null);
    setValidationError(null);
    clearError();
    if (!await markDefault(wallet.id)) return;
    setSuccessMessage(`Ahora ${wallet.name} es tu monedero predeterminado.`);
  }

  async function disableWallet(wallet: Wallet) {
    setSuccessMessage(null);
    setValidationError(null);
    clearError();
    if (wallet.is_default) {
      setValidationError('Primero marca otro monedero como predeterminado.');
      return;
    }
    if (activeWallets.length <= 1) {
      setValidationError('Debes tener al menos un monedero activo.');
      return;
    }
    const hasTransactions = wallet.has_transactions ?? (wallet.transaction_count ?? 0) > 0;
    const message = hasTransactions
      ? 'Este monedero tiene movimientos. Se desactivará y su historial se conservará.'
      : '¿Eliminar monedero? Esta acción no se puede deshacer.';
    if (!window.confirm(message)) return;
    if (await deactivate(wallet.id)) setSuccessMessage(hasTransactions ? 'Monedero desactivado. Su historial se conserva.' : 'Monedero eliminado.');
  }

  async function enableWallet(wallet: Wallet) {
    setSuccessMessage(null);
    setValidationError(null);
    clearError();
    if (await reactivate(wallet.id)) setSuccessMessage('Monedero reactivado.');
  }

  return (
    <main className="h-full w-full overflow-y-auto bg-bg px-4 pb-24 sm:px-6">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-[4.5rem] items-center border-b border-ink-300 bg-white px-4 sm:-mx-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <h1 className="font-semibold text-ink-900">Monederos</h1>
          <Link to="/monederos/nuevo" className="hidden min-h-11 items-center justify-center rounded-md bg-accent-600 px-4 text-sm font-semibold text-white hover:bg-accent-700 sm:inline-flex">Nuevo monedero</Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl">
        {showInfo && <aside className="mb-4 flex items-start gap-3 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
          <Info aria-hidden="true" className="mt-0.5 shrink-0 text-accent-600" size={20} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">¿Cómo funciona un monedero?</p>
            <p className="mt-1 text-sm leading-5 text-ink-600">Es tu cuenta real (banco o efectivo) que registras tú mismo. Sube con cada ingreso y baja con cada gasto.</p>
          </div>
          <button type="button" aria-label="Cerrar información" onClick={() => setShowInfo(false)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-ink-700 hover:bg-bg"><X aria-hidden="true" size={18} /></button>
        </aside>}

        {successMessage && <p role="status" className="mb-4 rounded-xl border border-success-500/30 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">{successMessage}</p>}
        {(validationError ?? actionError) && <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-white px-4 py-3 text-sm text-danger-600">{validationError ?? actionError}</p>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]">
          <section className="order-last min-w-0 lg:order-first" aria-label="Lista de monederos">
            {loadError ? <section role="alert" className="rounded-xl border border-danger bg-white p-4 shadow-sm">
              <p className="text-sm text-danger-600">{loadError}</p>
              <button type="button" onClick={() => void reload()} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-accent-700 hover:bg-bg"><RotateCw aria-hidden="true" size={17} /> Reintentar</button>
            </section> : loading ? <div role="status" aria-label="Cargando monederos" className="space-y-3">
              {[0, 1].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-ink-200" />)}
              <span className="sr-only">Cargando monederos…</span>
            </div> : wallets.length === 0 ? <section className="rounded-xl border border-dashed border-ink-300 bg-white px-5 py-10 text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-xl bg-accent-100 text-accent-600"><WalletIcon aria-hidden="true" size={27} /></span>
              <h2 className="mt-4 font-semibold text-ink-900">Aún no tienes monederos</h2>
              <p className="mt-2 text-sm text-ink-600">Crea tu primer monedero para empezar.</p>
              <Link to="/monederos/nuevo" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent-600 px-4 text-sm font-semibold text-white hover:bg-accent-700">Nuevo monedero</Link>
            </section> : <div className="grid gap-3 sm:grid-cols-2" aria-label="Lista de monederos">
              {activeWallets.map((wallet) => <WalletCard key={wallet.id} wallet={wallet} busy={savingWalletId === wallet.id} onEdit={(item) => navigate(`/monederos/${encodeURIComponent(item.id)}/editar`)} onMarkDefault={chooseDefault} onDeactivate={disableWallet} onReactivate={enableWallet} />)}
              {inactiveWallets.length > 0 && <section aria-labelledby="inactive-wallets-heading" className="grid gap-3 pt-4 sm:col-span-2">
                <h2 id="inactive-wallets-heading" className="text-sm font-semibold text-ink-600">Monederos inactivos</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {inactiveWallets.map((wallet) => <WalletCard key={wallet.id} wallet={wallet} busy={savingWalletId === wallet.id} onEdit={(item) => navigate(`/monederos/${encodeURIComponent(item.id)}/editar`)} onMarkDefault={chooseDefault} onDeactivate={disableWallet} onReactivate={enableWallet} />)}
                </div>
              </section>}
              </div>}
          </section>
          <aside className="order-first h-fit rounded-xl border border-ink-300 bg-white p-5 shadow-sm lg:sticky lg:top-20 lg:order-last">
            <p className="text-sm font-medium text-ink-600">Total en {mainCurrency}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{formatCents(total, mainCurrency)}</p>
            <p className="mt-2 text-xs leading-5 text-ink-500">Suma de los saldos de tus monederos activos en tu moneda principal.</p>
            <p className="mt-5 border-l-2 border-ink-300 pl-2 text-xs text-ink-500">No conecta cuentas ni mueve dinero real.</p>
          </aside>
        </div>

        <Link to="/monederos/nuevo" className="mt-6 mb-8 flex min-h-11 w-full items-center justify-center rounded-md bg-accent-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 sm:hidden">Nuevo monedero</Link>
      </div>
    </main>
  );
}

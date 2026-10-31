import { Info, RotateCw, Wallet as WalletIcon, X } from 'lucide-react';
import { useState } from 'react';
import { WalletCard } from '../components/WalletCard';
import { WalletForm, type WalletFormValues } from '../components/WalletForm';
import { useWallets } from '../hooks/useWallets';
import type { Wallet } from '../types/wallet.types';

function normalizeBalance(balance: string): string {
  const [whole = '0', fraction = ''] = balance.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function WalletsPage() {
  const { wallets, loading, saving, error, clearError, reload, create, update } = useWallets();
  const [formOpen, setFormOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState<Wallet | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);

  const openCreate = () => {
    setSuccessMessage(null);
    clearError();
    setEditingWallet(null);
    setFormOpen(true);
  };

  const openEdit = (wallet: Wallet) => {
    setSuccessMessage(null);
    clearError();
    setEditingWallet(wallet);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingWallet(null);
    clearError();
  };

  const submit = async (values: WalletFormValues) => {
    if (editingWallet) {
      await update(editingWallet.id, { name: values.name, balance: normalizeBalance(values.balance) });
    } else {
      await create({ name: values.name, type: values.type, currency: values.currency, balance: normalizeBalance(values.balance) });
    }
    setSuccessMessage(editingWallet ? 'Monedero actualizado.' : 'Monedero creado.');
    setFormOpen(false);
    setEditingWallet(null);
  };

  return (
    <>
      <main className="h-full w-full overflow-y-auto bg-gray-50 px-4 pb-24 sm:px-6">
        <div className="mx-auto w-full max-w-6xl">
          <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-[4.5rem] items-center border-b border-gray-200 bg-white px-4 sm:-mx-6 sm:px-6">
            <h1 className="font-semibold text-ink-900">Monederos</h1>
          </header>

          {showInfo && (
            <aside className="mb-4 flex items-start gap-3 rounded-xl border border-ink-300 bg-white p-4 shadow-sm">
              <Info aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600" size={20} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">¿Cómo funciona un monedero?</p>
                <p className="mt-1 text-sm leading-6 text-gray-600">Organiza por separado el dinero que tienes en tus cuentas bancarias y en efectivo.</p>
              </div>
              <button type="button" aria-label="Cerrar información" onClick={() => setShowInfo(false)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-700 hover:bg-bg">
                <X aria-hidden="true" size={18} />
              </button>
            </aside>
          )}

          {successMessage && <p role="status" className="mb-4 rounded-xl border border-brand-100 bg-brand-100 px-4 py-3 text-sm font-medium text-brand-700">{successMessage}</p>}

          {loading ? (
            <div role="status" aria-label="Cargando monederos" className="pb-2">
              {[0, 1].map((item) => <div key={item} className="mb-3 h-40 animate-pulse rounded-xl bg-gray-200" />)}
              <span className="sr-only">Cargando monederos…</span>
            </div>
          ) : error && !formOpen ? (
            <section role="alert" className="mb-3 rounded-xl border border-danger bg-white p-5 shadow-sm">
              <p className="font-medium text-ink-900">{error}</p>
              <button type="button" onClick={() => void reload()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                <RotateCw aria-hidden="true" size={17} /> Reintentar
              </button>
            </section>
          ) : wallets.length === 0 ? (
            <section className="mb-3 rounded-xl border border-dashed border-ink-300 bg-white px-5 py-10 text-center shadow-sm">
              <span className="mx-auto flex size-14 items-center justify-center rounded-md bg-bg text-brand-600"><WalletIcon aria-hidden="true" size={27} /></span>
              <h2 className="mt-4 font-semibold text-ink-900">Aún no tienes monederos</h2>
              <p className="mt-2 text-sm text-ink-500">Crea uno para empezar a organizar tu dinero.</p>
            </section>
          ) : (
            <section aria-label="Lista de monederos">
              {wallets.map((wallet) => <WalletCard key={wallet.id} wallet={wallet} onEdit={openEdit} />)}
            </section>
          )}

          <div className="my-6 border-l-2 border-ink-300 pl-2">
            <p className="text-xs font-medium text-ink-500">No conecta cuentas ni mueve dinero real.</p>
          </div>

          <button type="button" onClick={openCreate} className="mt-4 mb-8 flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
            Nuevo monedero
          </button>
        </div>
      </main>
      {formOpen && <WalletForm wallet={editingWallet} saving={saving} error={error} onClose={closeForm} onSubmit={submit} />}
    </>
  );
}

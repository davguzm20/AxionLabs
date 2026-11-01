import { Bell, ChevronRight, DollarSign, Lock, PieChart, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotificationPreferences } from '../../notifications/hooks/useNotificationPreferences';

export function SettingsPage() {
  const navigate = useNavigate();
  const {
    preferences,
    isLoading: preferencesLoading,
    error: preferencesError,
    refetch: refetchPreferences,
    saveEmailNotifications,
    isSaving: preferencesSaving,
    saveError,
  } = useNotificationPreferences();
  const notificationsEnabled = preferences?.email_notifications ?? true;

  return (
    <main className="h-full w-full overflow-y-auto bg-gray-50 px-4 pb-24 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <header className="sticky top-0 z-10 -mx-4 mb-4 flex h-[4.5rem] items-center border-b border-gray-200 bg-white px-4 sm:-mx-6 sm:px-6">
          <h1 className="font-semibold text-ink-900">Ajustes</h1>
        </header>

        <section aria-label="Perfil" className="mb-6 flex items-center gap-4 rounded-xl border border-ink-300 bg-white p-5 shadow-sm">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-bg text-ink-500">
            <User aria-hidden="true" size={26} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-ink-900">David Guzmán</h2>
            <p className="truncate text-sm leading-6 text-ink-500">david.guzman@axonlabs.com</p>
          </div>
        </section>

        <section aria-labelledby="settings-account-heading" className="mb-6">
          <h2 id="settings-account-heading" className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-gray-500">Cuenta</h2>
          <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-ink-300 bg-white p-4 text-left shadow-sm hover:bg-bg">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center"><Lock aria-hidden="true" className="text-ink-500" size={20} /></span>
              <span className="text-sm font-medium text-gray-800">Cambiar contraseña</span>
            </span>
            <ChevronRight aria-hidden="true" className="shrink-0 text-ink-500" size={18} />
          </button>
        </section>

        <section aria-labelledby="settings-management-heading">
          <h2 id="settings-management-heading" className="mb-2 ml-1 text-xs font-medium uppercase tracking-wider text-gray-500">Gestión</h2>
          <div className="flex flex-col overflow-hidden rounded-xl border border-ink-300 bg-white shadow-sm">
            <button type="button" onClick={() => navigate('/presupuestos')} className="flex w-full items-center justify-between border-b border-ink-300 p-4 text-left hover:bg-bg">
              <span className="flex items-center gap-3">
                <PieChart aria-hidden="true" className="shrink-0 text-gray-600" size={20} />
                <span className="text-sm font-medium text-gray-800">Presupuestos y alertas</span>
              </span>
              <ChevronRight aria-hidden="true" className="shrink-0 text-gray-400" size={20} />
            </button>
            <div className="flex w-full items-center justify-between border-b border-ink-300 p-4">
              <span className="flex items-center gap-3">
                <Bell aria-hidden="true" className="shrink-0 text-gray-600" size={20} />
                <span className="text-sm font-medium text-gray-800">Notificaciones</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={notificationsEnabled}
                aria-label="Notificaciones por correo"
                disabled={preferencesLoading || preferencesSaving || Boolean(preferencesError)}
                onClick={() => saveEmailNotifications(!notificationsEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-wait disabled:opacity-60 ${notificationsEnabled ? 'bg-brand-600' : 'bg-gray-400'
                  }`}
              >
                <span
                  className={`pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>
            <p className="border-b border-ink-300 px-4 pb-3 pl-12 text-xs text-ink-500">
              Las alertas dentro de la app siempre están activas; este ajuste controla el correo.
            </p>
            {preferencesError && <div role="alert" className="border-b border-ink-300 px-4 py-2 pl-12 text-sm text-danger-600"><p>No pudimos cargar esta preferencia.</p><button type="button" onClick={() => void refetchPreferences()} className="mt-1 min-h-11 font-medium text-brand-700 underline">Reintentar</button></div>}
            {saveError && <p role="alert" className="border-b border-ink-300 px-4 py-2 pl-12 text-sm text-danger-600">No se pudo guardar la preferencia. Inténtalo nuevamente.</p>}
            <div className="flex w-full items-center justify-between p-4">
              <span className="flex items-center gap-3">
                <DollarSign aria-hidden="true" className="shrink-0 text-gray-600" size={20} />
                <span className="text-sm font-medium text-gray-800">Moneda principal</span>
              </span>
              <span className="text-sm text-gray-500">PEN (S/.)</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

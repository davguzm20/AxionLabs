import { NavLink } from 'react-router-dom';
import { History, Home, Settings, Wallet } from 'lucide-react';

const items = [
  { label: 'Inicio', path: '/inicio', icon: Home },
  { label: 'Historial', path: '/historial', icon: History },
  { label: 'Monederos', path: '/monederos', icon: Wallet },
  { label: 'Ajustes', path: '/ajustes', icon: Settings },
];

export function BottomNav() {
  return (
    <nav aria-label="Navegación principal" className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-300 bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid h-16 grid-cols-4">
        {items.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              aria-label={item.label}
                className={({ isActive }) => `flex h-full min-h-11 flex-col items-center justify-center gap-1 text-xs ${isActive ? 'font-semibold text-brand-500' : 'text-ink-500'}`}
            >
                <item.icon aria-hidden="true" size={24} />
                <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

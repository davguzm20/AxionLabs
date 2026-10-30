import { NavLink } from 'react-router-dom';

const items = [
  { label: 'Inicio', path: '/inicio', icon: '⌂' },
  { label: 'Historial', path: '/historial', icon: '↶' },
  { label: 'Monederos', path: '/monederos', icon: '▣' },
  { label: 'Ajustes', path: '/ajustes', icon: '⚙' },
];

export function Sidebar() {
  return (
    <aside className="hidden min-h-screen w-64 shrink-0 border-r border-ink-300 bg-surface p-6 lg:block">
      <a href="/inicio" className="mb-10 block font-display text-h2 text-brand-600">KhipuBot</a>
      <nav aria-label="Navegación principal">
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-md px-3 text-body ${isActive ? 'bg-brand-100 font-semibold text-brand-700' : 'text-ink-700 hover:bg-bg'}`}
              >
                <span aria-hidden="true" className="w-6 text-center">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

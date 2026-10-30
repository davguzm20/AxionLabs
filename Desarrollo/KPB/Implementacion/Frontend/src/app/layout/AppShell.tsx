import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="h-dvh w-full overflow-hidden bg-white text-ink-900 lg:flex">
      <Sidebar />
      <main className="h-full min-w-0 w-full flex-1 overflow-hidden bg-white">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

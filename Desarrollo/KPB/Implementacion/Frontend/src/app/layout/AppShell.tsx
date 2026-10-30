import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="min-h-screen bg-bg text-ink-900 lg:flex">
      <Sidebar />
      <main className="mx-auto min-h-screen w-full max-w-[1200px] flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-8">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-content-center gap-4 bg-bg p-6 text-center">
      <h1 className="font-display text-h1">No encontramos esta página</h1>
      <Link className="text-brand-600 underline" to="/inicio">Volver al inicio</Link>
    </main>
  );
}

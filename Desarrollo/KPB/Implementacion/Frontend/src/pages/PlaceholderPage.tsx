type PlaceholderPageProps = { title: string };

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <section aria-labelledby="page-title" className="rounded-lg bg-surface p-6 shadow-sm">
      <h1 id="page-title" className="font-display text-h1">{title}</h1>
      <p className="mt-4 text-body text-ink-500">En construcción</p>
    </section>
  );
}

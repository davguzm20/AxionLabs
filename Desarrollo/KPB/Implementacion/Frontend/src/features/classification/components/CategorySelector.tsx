import { Check, ChevronDown, Pencil, Tag } from 'lucide-react';
import { useState } from 'react';
import type { Category } from '../types/classification.types';

interface CategorySelectorProps {
  categories: Category[];
  selectedCategory: Category | null;
  suggestedCategory: Category | null;
  onSelect: (category: Category) => void;
}

export function CategorySelector({ categories, selectedCategory, suggestedCategory, onSelect }: CategorySelectorProps) {
  const [editing, setEditing] = useState(false);

  return (
    <section aria-labelledby="category-selector-title" className="rounded-xl border border-ink-300 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="category-selector-title" className="text-base font-semibold text-ink-900">Categoría sugerida</h2>
          <p className="mt-1 text-sm text-ink-500">Puedes cambiarla antes de confirmar.</p>
        </div>
        <Tag aria-hidden="true" className="shrink-0 text-brand-600" size={22} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-100 p-3">
        <span className="font-semibold text-brand-700">{selectedCategory?.name ?? 'Sin clasificar'}</span>
        {suggestedCategory && selectedCategory?.id !== suggestedCategory.id && (
          <span className="text-xs text-ink-500">Sugerencia: {suggestedCategory.name}</span>
        )}
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          aria-expanded={editing}
          aria-controls="category-options"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-brand-700 hover:bg-white"
        >
          {editing ? <ChevronDown aria-hidden="true" size={18} /> : <Pencil aria-hidden="true" size={18} />}
          {editing ? 'Cerrar opciones' : 'Cambiar categoría'}
        </button>
      </div>

      {editing && (
        <div id="category-options" role="group" aria-label="Seleccionar categoría" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {categories.map((category) => {
            const selected = selectedCategory?.id === category.id;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(category)}
                className={`flex min-h-11 items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${selected ? 'border-brand-600 bg-brand-100 font-semibold text-brand-700' : 'border-ink-300 text-ink-700 hover:bg-bg'}`}
              >
                {category.name}
                {selected && <Check aria-hidden="true" size={18} />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

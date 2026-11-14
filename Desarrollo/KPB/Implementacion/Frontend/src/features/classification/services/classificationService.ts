import { api } from '../../../lib/api';
import type {
  CategoriesResponse,
  Category,
  ClassificationRequest,
  ClassificationResponse,
} from '../types/classification.types';

export async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error('No se pudo obtener la clasificación. Inténtalo nuevamente.');
  }

  return response.json() as Promise<T>;
}

export async function getCategories(
  signal?: AbortSignal,
  type?: Category['type'],
): Promise<CategoriesResponse> {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  const payload = await api<unknown>(`/categories${query}`, { signal });
  const categories = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;

  if (!categories) throw new Error('La respuesta de categorías no es válida.');

  return categories.map((item) => {
    const category = item as Category;
    return { ...category, type: String(category.type).toUpperCase() as Category['type'] };
  });
}

export async function classifyTransaction(
  request: ClassificationRequest,
  signal?: AbortSignal,
): Promise<ClassificationResponse> {
  return api<ClassificationResponse>('/categories/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
}

export function getFallbackCategory(categories: Category[]): Category {
  return categories.find((category) => category.name === 'Otros') ?? {
    id: 'category-other',
    name: 'Otros',
    type: 'EXPENSE',
    icon: 'circle-help',
  };
}

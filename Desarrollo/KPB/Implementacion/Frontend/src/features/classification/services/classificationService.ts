import type {
  CategoriesResponse,
  Category,
  ClassificationRequest,
  ClassificationResponse,
} from '../types/classification.types';

const API_BASE = '/api/v1';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error('No se pudo obtener la clasificación. Inténtalo nuevamente.');
  }

  return response.json() as Promise<T>;
}

export async function getCategories(signal?: AbortSignal): Promise<CategoriesResponse> {
  const response = await fetch(`${API_BASE}/categories`, { signal });
  const payload = await parseResponse<unknown>(response);
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
  const response = await fetch(`${API_BASE}/categories/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  return parseResponse<ClassificationResponse>(response);
}

export function getFallbackCategory(categories: Category[]): Category {
  return categories.find((category) => category.name === 'Otros') ?? {
    id: 'category-other',
    name: 'Otros',
    type: 'EXPENSE',
    icon: 'circle-help',
  };
}

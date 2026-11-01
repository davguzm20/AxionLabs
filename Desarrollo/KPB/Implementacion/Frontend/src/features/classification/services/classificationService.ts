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
  return parseResponse<CategoriesResponse>(response);
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

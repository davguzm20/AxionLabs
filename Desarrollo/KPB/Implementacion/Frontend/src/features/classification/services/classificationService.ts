import type {
  CategoriesResponse,
  Category,
  ApiCategory,
  ClassificationRequest,
  ClassificationResponse,
} from '../types/classification.types';
import { createApiHeaders } from '../../../lib/api';

const API_BASE = '/api/v1';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error('No se pudo obtener la clasificación. Inténtalo nuevamente.');
  }

  return response.json() as Promise<T>;
}

export async function getCategories(signal?: AbortSignal): Promise<Category[]> {
  const response = await fetch(`${API_BASE}/categories`, { headers: createApiHeaders(), signal });
  const result = await parseResponse<CategoriesResponse>(response);
  return result.data.map((category: ApiCategory) => ({
    ...category,
    type: category.type.toUpperCase() as Category['type'],
    icon: 'circle-help',
  }));
}

export async function classifyTransaction(
  request: ClassificationRequest,
  signal?: AbortSignal,
): Promise<ClassificationResponse> {
  const response = await fetch(`${API_BASE}/categories/suggestions`, {
    method: 'POST',
    headers: createApiHeaders({ 'Content-Type': 'application/json' }),
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

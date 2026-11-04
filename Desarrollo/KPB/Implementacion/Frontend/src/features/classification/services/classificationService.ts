import type {
  CategoriesResponse,
  Category,
  ApiCategory,
  ClassificationRequest,
  ClassificationResponse,
} from '../types/classification.types';
import { apiRaw } from '../../../lib/api';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error('No se pudo obtener la clasificación. Inténtalo nuevamente.');
  }

  return response.json() as Promise<T>;
}

export async function getCategories(signal?: AbortSignal): Promise<Category[]> {
  const response = await apiRaw('/categories', { signal });
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
  const response = await apiRaw('/categories/suggestions', {
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

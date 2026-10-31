import type { AlertThreshold } from '../types/alert.types';

const API = '/api/v1';

interface ThresholdResponse {
  category_id: string;
  thresholds: number[];
  channels: string[];
  is_default: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(body?.error?.message ?? body?.message ?? 'No se pudo guardar la configuración de alertas.');
  }
  return response.json() as Promise<T>;
}

function toAlertThreshold(result: ThresholdResponse): AlertThreshold {
  return {
    categoryId: result.category_id,
    thresholds: result.thresholds,
    channels: result.channels,
    isDefault: result.is_default,
  };
}

export async function getThresholds(categoryId: string, signal?: AbortSignal): Promise<AlertThreshold> {
  const result = await request<ThresholdResponse>(
    `${API}/budgets/${encodeURIComponent(categoryId)}/alert-thresholds`,
    { signal },
  );
  return toAlertThreshold(result);
}

export async function putThresholds(
  categoryId: string,
  payload: Pick<AlertThreshold, 'thresholds' | 'channels'>,
): Promise<AlertThreshold> {
  const result = await request<ThresholdResponse>(
    `${API}/budgets/${encodeURIComponent(categoryId)}/alert-thresholds`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return toAlertThreshold(result);
}

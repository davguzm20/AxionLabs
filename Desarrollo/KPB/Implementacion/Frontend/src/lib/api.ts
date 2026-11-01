import { ApiError } from './errors';

export { ApiError } from './errors';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

export function buildApiUrl(path: string): string {
  return apiBaseUrl + path;
}

export function createApiHeaders(headers?: HeadersInit): Headers {
  const requestHeaders = new Headers(headers);
  const accessToken = typeof localStorage === 'undefined' ? null : localStorage.getItem('access_token');
  if (accessToken && !requestHeaders.has('Authorization')) {
    requestHeaders.set('Authorization', 'Bearer ' + accessToken);
  }
  return requestHeaders;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = createApiHeaders(init.headers);
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const hasBody = init.body !== undefined && init.body !== null;

  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(buildApiUrl(path), { ...init, headers });
  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => undefined) as {
    error?: { message?: string; code?: string; details?: { field: string; message: string }[] };
    message?: string;
  } | undefined;

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || payload?.message || 'No se pudo completar la solicitud. Inténtalo nuevamente.',
      response.status,
      payload?.error?.code,
      payload?.error?.details,
    );
  }

  return payload as T;
}

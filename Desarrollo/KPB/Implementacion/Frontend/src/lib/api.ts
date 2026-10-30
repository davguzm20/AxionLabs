export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const hasBody = init.body !== undefined && init.body !== null;

  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const accessToken = typeof localStorage === 'undefined' ? null : localStorage.getItem('access_token');
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', 'Bearer ' + accessToken);
  }

  const response = await fetch(apiBaseUrl + path, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => undefined) as {
    error?: { message?: string; code?: string };
    message?: string;
  } | undefined;

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || payload?.message || 'No se pudo completar la solicitud. Inténtalo nuevamente.',
      response.status,
      payload?.error?.code,
    );
  }

  return payload as T;
}

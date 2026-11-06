export interface ApiErrorDetail {
  field: string;
  issue?: string;
  message?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: ApiErrorDetail[];
  readonly traceId?: string;

  constructor(message: string, status: number, code?: string, details?: ApiErrorDetail[], traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.traceId = traceId;
  }
}

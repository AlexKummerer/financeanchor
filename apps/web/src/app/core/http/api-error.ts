import { HttpErrorResponse } from '@angular/common/http';

/** Fehler der API im einheitlichen Format `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof HttpErrorResponse) {
    const body = err.error as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    if (body?.error?.code) {
      return new ApiError(
        err.status,
        body.error.code,
        body.error.message ?? '',
        body.error.details,
      );
    }
    if (err.status === 0) return new ApiError(0, 'network', 'Network error');
    return new ApiError(err.status, 'http_error', err.message);
  }
  return new ApiError(0, 'unknown', String(err));
}

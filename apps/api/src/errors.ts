import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Fachlicher Fehler mit stabilem Code für die Oberfläche. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'resource') => new AppError(404, 'not_found', `${what} not found`);

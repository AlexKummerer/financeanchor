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

function messages(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 5; i++) {
    if (e instanceof Error) parts.push(e.message);
    e = (e as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

/** Übersetzt Constraint-Verletzungen von D1 in fachliche Fehler, sonst `null`. */
export function fromDbError(err: unknown, method: string): AppError | null {
  const msg = messages(err);
  if (msg.includes('UNIQUE constraint failed'))
    return new AppError(409, 'conflict', 'Already exists');
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return method === 'DELETE'
      ? new AppError(409, 'in_use', 'Still referenced by other data')
      : new AppError(400, 'invalid_reference', 'Referenced record does not exist');
  }
  if (msg.includes('CHECK constraint failed')) {
    return new AppError(400, 'validation_failed', 'Invalid value');
  }
  return null;
}

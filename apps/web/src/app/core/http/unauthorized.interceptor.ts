import type { HttpInterceptorFn } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/** Läuft die Session während der Nutzung ab, geht es zurück zum Login. */
export const unauthorizedInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  return next(req).pipe(
    catchError((err: unknown) => {
      const isAuthCall = req.url.includes('/api/auth/') || req.url.endsWith('/api/me');
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !isAuthCall &&
        auth.isAuthenticated()
      ) {
        auth.sessionEnded();
      }
      return throwError(() => err);
    }),
  );
};

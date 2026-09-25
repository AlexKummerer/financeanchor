import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { API_BASE_URL } from '../config';
import { TokenStore } from '../auth/token-store';

/**
 * Setzt die API-Basis-URL und schickt Cookies mit. Liegt ein Token vor (später in der nativen App),
 * wird es als Bearer-Header gesendet; im Web bleibt es beim HttpOnly-Cookie.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  const base = inject(API_BASE_URL);
  const token = inject(TokenStore).token();
  return next(
    req.clone({
      url: `${base}${req.url}`,
      withCredentials: true,
      ...(token ? { setHeaders: { Authorization: `Bearer ${token}` } } : {}),
    }),
  );
};

import { InjectionToken } from '@angular/core';
import { environment } from '../../environments/environment';

/** Basis-URL der API. Leer = gleiche Origin; Capacitor-Builds setzen die volle URL. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  factory: () => environment.apiBaseUrl,
});

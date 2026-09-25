import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { apiInterceptor } from './core/http/api.interceptor';
import { unauthorizedInterceptor } from './core/http/unauthorized.interceptor';
import { LANGS, TranslocoHttpLoader, initialLang } from './core/i18n/transloco-loader';
import { ThemeService } from './core/ui/theme.service';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor, unauthorizedInterceptor])),
    provideTransloco({
      config: {
        availableLangs: [...LANGS],
        defaultLang: initialLang(),
        fallbackLang: 'de',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
      },
      loader: TranslocoHttpLoader,
    }),
    // Vor dem ersten Rendern: Theme anwenden und prüfen, ob eine Session besteht.
    provideAppInitializer(() => {
      inject(ThemeService);
      return inject(AuthService).refresh();
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

import { HttpClient } from '@angular/common/http';
import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Me } from '@financeanchor/shared';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../http/api-error';
import { ExternalNavigation } from '../platform/external-navigation';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';
export type SocialProvider = 'google' | 'microsoft' | 'apple';

/** Session des Nutzers. Die Session selbst liegt im HttpOnly-Cookie; hier nur der Zustand. */
@Service()
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly external = inject(ExternalNavigation);

  readonly me = signal<Me | null>(null);
  readonly status = signal<AuthStatus>('unknown');
  readonly isAuthenticated = computed(() => this.status() === 'authenticated');
  /** Anbieter, die der Server anbietet (Zugangsdaten hinterlegt) */
  readonly socialProviders = signal<SocialProvider[]>([]);

  /** Lädt den angemeldeten Nutzer; ohne Session gilt man als abgemeldet. */
  async refresh(): Promise<void> {
    try {
      const me = await firstValueFrom(this.http.get<Me>('/api/me'));
      this.me.set(me);
      this.status.set('authenticated');
      this.transloco.setActiveLang(me.settings.locale);
    } catch (err) {
      const e = toApiError(err);
      if (e.status !== 401) console.error('Laden der Session fehlgeschlagen', e);
      this.me.set(null);
      this.status.set('anonymous');
    }
  }

  async login(email: string, password: string): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/auth/sign-in/email', { email, password, rememberMe: true }),
    ).catch((err: unknown) => {
      throw toApiError(err);
    });
    await this.refresh();
  }

  async loadAuthOptions(): Promise<void> {
    try {
      const o = await firstValueFrom(
        this.http.get<{ social: SocialProvider[] }>('/api/auth-options'),
      );
      this.socialProviders.set(o.social);
    } catch {
      this.socialProviders.set([]);
    }
  }

  /**
   * Anmeldung beim Anbieter starten. Klappt sie nicht (z. B. Konto noch nicht verbunden), kommt
   * man mit `?error=…` zur Login-Seite zurück.
   */
  async socialLogin(provider: SocialProvider, returnUrl: string): Promise<void> {
    const res = await this.post<{ url: string }>('/api/auth/sign-in/social', {
      provider,
      callbackURL: this.external.appUrl(returnUrl),
      errorCallbackURL: this.external.appUrl('/login'),
    });
    this.external.go(res.url);
  }

  /** Anbieter mit dem angemeldeten Konto verbinden; Rücksprung in die Einstellungen. */
  async linkSocial(provider: SocialProvider): Promise<void> {
    const back = this.external.appUrl(`/einstellungen?verbunden=${provider}`);
    const res = await this.post<{ url: string }>('/api/auth/link-social', {
      provider,
      callbackURL: back,
      errorCallbackURL: this.external.appUrl('/einstellungen'),
    });
    this.external.go(res.url);
  }

  async linkedProviders(): Promise<string[]> {
    const accounts = await firstValueFrom(
      this.http.get<{ providerId: string }[]>('/api/auth/list-accounts'),
    );
    return accounts.map((a) => a.providerId);
  }

  async unlinkSocial(provider: SocialProvider): Promise<void> {
    await this.post('/api/auth/unlink-account', { providerId: provider });
  }

  private post<T>(url: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(url, body)).catch((err: unknown) => {
      throw toApiError(err);
    });
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/sign-out', {}));
    } finally {
      this.sessionEnded();
    }
  }

  /** Session ist abgelaufen oder wurde beendet. */
  sessionEnded(): void {
    this.me.set(null);
    this.status.set('anonymous');
    void this.router.navigate(['/login']);
  }

  patchSettings(settings: Partial<Me['settings']>): void {
    this.me.update((m) => (m ? { ...m, settings: { ...m.settings, ...settings } } : m));
  }
}

import { HttpClient } from '@angular/common/http';
import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Me } from '@financeanchor/shared';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../http/api-error';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

/** Session des Nutzers. Die Session selbst liegt im HttpOnly-Cookie; hier nur der Zustand. */
@Service()
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  readonly me = signal<Me | null>(null);
  readonly status = signal<AuthStatus>('unknown');
  readonly isAuthenticated = computed(() => this.status() === 'authenticated');

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

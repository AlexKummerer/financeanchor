import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import type { Locale, UserSettings } from '@financeanchor/shared';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService, type ThemeChoice } from '../../core/ui/theme.service';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  selector: 'fa-settings',
  imports: [TranslocoPipe],
  template: `
    <div class="panel stack">
      <div>
        <label for="theme">{{ 'settings.theme' | transloco }}</label>
        <select id="theme" [value]="theme.choice()" (change)="setTheme($any($event.target).value)">
          <option value="system">{{ 'settings.themeSystem' | transloco }}</option>
          <option value="light">{{ 'settings.themeLight' | transloco }}</option>
          <option value="dark">{{ 'settings.themeDark' | transloco }}</option>
        </select>
      </div>
      <div>
        <label for="lang">{{ 'settings.language' | transloco }}</label>
        <select
          id="lang"
          [value]="auth.me()?.settings?.locale ?? 'de'"
          (change)="setLang($any($event.target).value)"
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>

    <h2>{{ 'settings.account' | transloco }}</h2>
    <div class="panel stack">
      <p>{{ auth.me()?.user?.email }}</p>
      @if (auth.me()?.entitlement; as e) {
        <p class="small muted">{{ 'settings.plan.' + e.plan | transloco }}</p>
      }
      <div class="btnrow">
        <button class="btn ghost" type="button" (click)="logout()">
          {{ 'settings.logout' | transloco }}
        </button>
      </div>
    </div>
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly http = inject(HttpClient);
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);

  protected setTheme(value: ThemeChoice) {
    this.theme.choice.set(value);
  }

  protected async setLang(locale: Locale) {
    this.transloco.setActiveLang(locale);
    try {
      const s = await firstValueFrom(this.http.patch<UserSettings>('/api/settings', { locale }));
      this.auth.patchSettings(s);
    } catch {
      this.toast.show(this.transloco.translate('errors.saveFailed'), 'error');
    }
  }

  protected logout() {
    void this.auth.logout();
  }
}
